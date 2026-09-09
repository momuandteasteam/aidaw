#pragma once

#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <ole2.h>
#include <shobjidl.h>
#include <shlguid.h>
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#endif

namespace aidaw {
#if JUCE_WINDOWS
class ImmediateFileDropSource final : public IDropSource {
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** value) override {
        if (value == nullptr) return E_POINTER;
        if (iid == IID_IUnknown || iid == IID_IDropSource) { *value = static_cast<IDropSource*>(this); AddRef(); return S_OK; }
        *value = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return static_cast<ULONG>(InterlockedIncrement(&references)); }
    ULONG STDMETHODCALLTYPE Release() override {
        const auto remaining = InterlockedDecrement(&references); if (remaining == 0) delete this; return static_cast<ULONG>(remaining);
    }
    HRESULT STDMETHODCALLTYPE QueryContinueDrag(BOOL escapePressed, DWORD) override { return escapePressed ? DRAGDROP_S_CANCEL : DRAGDROP_S_DROP; }
    HRESULT STDMETHODCALLTYPE GiveFeedback(DWORD) override { return DRAGDROP_S_USEDEFAULTCURSORS; }
private:
    LONG references = 1;
};

double kontaktAudioProbe(juce::AudioPluginInstance& plugin, int pitch, int timeoutMs) {
    plugin.disableNonMainBuses(); auto layout = plugin.getBusesLayout();
    if (!layout.outputBuses.isEmpty()) layout.outputBuses.getReference(0) = juce::AudioChannelSet::stereo();
    if (!layout.inputBuses.isEmpty()) layout.inputBuses.getReference(0) = juce::AudioChannelSet::disabled();
    check(plugin.setBusesLayout(layout), "Kontakt stereo layout not supported");
    plugin.setNonRealtime(true); plugin.setRateAndBufferSizeDetails(rate, block); plugin.prepareToPlay(rate, block);
    juce::AudioBuffer<float> audio(std::max(2, plugin.getTotalNumOutputChannels()), block); double peak = 0;
    const auto deadline = juce::Time::getMillisecondCounterHiRes() + timeoutMs; int iteration = 0;
    while (juce::Time::getMillisecondCounterHiRes() < deadline && peak < 1.0e-5) {
        audio.clear(); juce::MidiBuffer midi; const int phase = iteration % 188;
        if (phase == 0) midi.addEvent(juce::MidiMessage::noteOn(1, pitch, static_cast<juce::uint8>(100)), 0);
        if (phase == 94) midi.addEvent(juce::MidiMessage::noteOff(1, pitch), 0);
        plugin.processBlock(audio, midi);
        for (int channel = 0; channel < std::min(2, audio.getNumChannels()); ++channel)
            for (int sample = 0; sample < audio.getNumSamples(); ++sample) peak = std::max(peak, static_cast<double>(std::abs(audio.getSample(channel, sample))));
        juce::MessageManager::getInstance()->runDispatchLoopUntil(2); ++iteration;
    }
    plugin.releaseResources(); return peak;
}

void dropKontaktFile(juce::AudioPluginInstance& plugin, const juce::File& file) {
    auto* editor = plugin.getActiveEditor(); if (editor == nullptr) editor = plugin.createEditorAndMakeActive();
    check(editor != nullptr, "Kontakt file loading requires its editor");
    if (editor->getPeer() == nullptr) editor->addToDesktop(juce::ComponentPeer::windowIsTemporary);
    editor->setTopLeftPosition(80, 80); editor->setAlwaysOnTop(true); editor->setVisible(true); editor->toFront(true);
    juce::MessageManager::getInstance()->runDispatchLoopUntil(500);
    auto hwnd = static_cast<HWND>(editor->getWindowHandle()); RECT bounds{}; POINT previous{};
    const bool haveWindow = hwnd != nullptr && GetWindowRect(hwnd, &bounds); const bool haveCursor = GetCursorPos(&previous);
    IShellItem* item = nullptr; IDataObject* data = nullptr; DWORD effect = DROPEFFECT_NONE;
    const auto initialized = OleInitialize(nullptr);
    HRESULT result = !haveWindow ? E_HANDLE : FAILED(initialized) ? initialized : SHCreateItemFromParsingName(file.getFullPathName().toWideCharPointer(), nullptr, IID_PPV_ARGS(&item));
    if (SUCCEEDED(result)) result = item->BindToHandler(nullptr, BHID_DataObject, IID_PPV_ARGS(&data));
    if (SUCCEEDED(result)) {
        const int width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
        const double xs[] = {0.90, 0.75, 0.60, 0.45}; const double ys[] = {0.30, 0.50, 0.70, 0.85};
        bool accepted = false;
        for (const auto y : ys) {
            for (const auto x : xs) {
                const POINT target{bounds.left + static_cast<LONG>(width * x), bounds.top + static_cast<LONG>(height * y)};
                SetCursorPos(target.x, target.y); effect = DROPEFFECT_COPY; auto* source = new ImmediateFileDropSource();
                result = DoDragDrop(data, source, DROPEFFECT_COPY, &effect); source->Release();
                if (result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE) { accepted = true; break; }
                juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
            }
            if (accepted) break;
        }
        if (haveCursor) SetCursorPos(previous.x, previous.y);
    }
    if (data != nullptr) data->Release(); if (item != nullptr) item->Release();
    if (SUCCEEDED(initialized)) OleUninitialize(); editor->setVisible(false); editor->setAlwaysOnTop(false);
    check(result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE,
        "Kontakt did not accept the instrument/snapshot file drop (HRESULT 0x" + juce::String::toHexString(static_cast<juce::int64>(result))
        + ", effect " + juce::String(static_cast<int>(effect)) + ")");
}
#endif

var kontaktPreset(juce::AudioPluginFormatManager& manager, const var& request) {
#if !JUCE_WINDOWS
    (void) manager; (void) request; throw std::runtime_error("Kontakt preset import is currently verified only on Windows");
#else
    auto plugin = load(manager, request["plugin"]); const auto description = plugin->getPluginDescription();
    check(description.pluginFormatName == "VST3" && description.manufacturerName == "Native Instruments" && description.name == "Kontakt 8" && description.version == "8.13.0",
        "Kontakt import is verified only for Native Instruments Kontakt 8 VST3 8.13.0 on Windows");
    const auto file = path(request["path"]); const auto extension = file.getFileExtension().toLowerCase();
    check(file.existsAsFile() && (extension == ".nki" || extension == ".nksn"), "Expected an existing Kontakt .nki or .nksn file");
    check(file.getSize() > 0 && file.getSize() <= 64 * 1024 * 1024, "Kontakt preset file size is outside the supported range");
    const auto pitch = request.hasProperty("probe_pitch") ? static_cast<int>(num(request["probe_pitch"], 0, 127)) : 60;
    juce::MemoryBlock before; plugin->getStateInformation(before); dropKontaktFile(*plugin, file);
    juce::MessageManager::getInstance()->runDispatchLoopUntil(4000);
    const auto loadedPeak = kontaktAudioProbe(*plugin, pitch, 60000); check(loadedPeak >= 1.0e-5, "Kontakt loaded the file but did not produce probe audio");
    juce::MemoryBlock state; plugin->getStateInformation(state); check(!state.isEmpty() && state != before, "Kontakt state did not change after loading the file");
    auto restoredSpec = request["plugin"].clone(); restoredSpec.getDynamicObject()->setProperty("state_base64", state.toBase64Encoding());
    auto restored = load(manager, restoredSpec); const auto restoredPeak = kontaktAudioProbe(*restored, pitch, 60000);
    check(restoredPeak >= 1.0e-5, "Kontakt saved state restored without playable audio");
    return obj({{"state_base64", state.toBase64Encoding()}, {"adapter", "kontakt_file_drop_v1"}, {"format", extension},
        {"loaded_probe_peak", loadedPeak}, {"restored_probe_peak", restoredPeak}});
#endif
}
}
