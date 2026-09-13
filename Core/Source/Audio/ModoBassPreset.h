#pragma once

// Adapter for the observed MODO BASS 2 VST3 2.0.5 state container.
// Only musical preset properties are changed; plugin settings and other state are retained.
namespace aidaw {
struct ModoState {
    std::unique_ptr<juce::XmlElement> wrapper;
    juce::MemoryBlock component;
    juce::ValueTree tree;
};
ModoState readModoState(juce::AudioPluginInstance& plugin) {
    juce::MemoryBlock saved; plugin.getStateInformation(saved);
    ModoState state; state.wrapper = juce::AudioProcessor::getXmlFromBinary(saved.getData(), static_cast<int>(saved.getSize()));
    check(state.wrapper && state.wrapper->hasTagName("VST3PluginState"), "Unsupported MODO BASS state wrapper");
    auto* component = state.wrapper->getChildByName("IComponent");
    check(component && state.component.fromBase64Encoding(component->getAllSubText()), "Missing MODO BASS component state");
    auto* data = static_cast<const char*>(state.component.getData());
    check(state.component.getSize() >= 176 && std::memcmp(data, "VstW", 4) == 0 && std::memcmp(data + 16, "CcnK", 4) == 0
        && std::memcmp(data + 24, "FBCh", 4) == 0 && std::memcmp(data + 32, "MBS2", 4) == 0, "Unsupported MODO BASS state format");
    const auto size = juce::ByteOrder::bigEndianInt(data + 172);
    check(size == state.component.getSize() - 176, "MODO BASS state length mismatch");
    state.tree = juce::ValueTree::readFromData(data + 176, size);
    check(state.tree.hasType("AppState"), "MODO BASS preset state is not AppState");
    return state;
}
bool modoValueMatches(const var& actual, const var& expected);
bool modoTreeMatches(const juce::ValueTree& actual, const juce::ValueTree& expected) {
    if (!actual.isValid() || actual.getType() != expected.getType() || actual.getNumChildren() != expected.getNumChildren()) return false;
    for (int i = 0; i < expected.getNumProperties(); ++i) {
        const auto key = expected.getPropertyName(i);
        if (key.toString() != "_name" && (!actual.hasProperty(key) || !modoValueMatches(actual[key], expected[key]))) return false;
    }
    for (int i = 0; i < expected.getNumChildren(); ++i) if (!modoTreeMatches(actual.getChild(i), expected.getChild(i))) return false;
    return true;
}
bool modoValueMatches(const var& actual, const var& expected) {
    if (expected.isDouble()) return std::abs(static_cast<double>(actual) - static_cast<double>(expected)) < 0.00001;
    if (actual == expected) return true;
    // Embedded amp/stomp trees are reserialized by MODO; compare their musical properties,
    // not unused trailing bytes or the preset display name.
    juce::MemoryBlock a, e;
    if (a.fromBase64Encoding(actual.toString()) && e.fromBase64Encoding(expected.toString())) {
        auto et = juce::ValueTree::readFromData(e.getData(), e.getSize());
        if (et.isValid()) return modoTreeMatches(juce::ValueTree::readFromData(a.getData(), a.getSize()), et);
    }
    return false;
}
var modoPreset(juce::AudioPluginFormatManager& manager, const var& request) {
    const auto& spec = request["plugin"];
    auto xml = juce::parseXML(spec["description_xml"].toString()); juce::PluginDescription d;
    check(xml && d.loadFromXml(*xml) && d.name == "MODO BASS 2" && d.pluginFormatName == "VST3" && d.version == "2.0.5",
        "This preset adapter is verified only for MODO BASS 2 VST3 2.0.5");
    auto plugin = load(manager, spec); auto state = readModoState(*plugin);
    auto preset = juce::parseXML(path(request["path"]));
    check(preset && preset->hasTagName("AppState"), "Expected a MODO BASS .mb2 AppState preset");
    juce::Array<var> applied;
    for (int i = 0; i < preset->getNumAttributes(); ++i) {
        auto name = preset->getAttributeName(i); if (name == "_name") continue;
        check(state.tree.hasProperty(name), "Unknown MODO BASS preset property: " + name);
        auto old = state.tree.getProperty(name); const auto text = preset->getAttributeValue(i); var value;
        if (old.isBool()) value = text.getIntValue() != 0;
        else if (old.isInt()) value = text.getIntValue();
        else if (old.isInt64()) value = text.getLargeIntValue();
        else if (old.isDouble()) value = text.getDoubleValue();
        else if (old.isBinaryData()) { juce::MemoryBlock bytes; check(bytes.fromBase64Encoding(text), "Invalid preset binary property"); value = var(bytes); }
        else value = text;
        state.tree.setProperty(name, value, nullptr); applied.add(name);
    }
    juce::MemoryBlock payload; juce::MemoryOutputStream stream(payload, false); state.tree.writeToStream(stream); stream.flush();
    juce::MemoryBlock next(state.component.getData(), 176); next.append(payload.getData(), payload.getSize());
    auto* bytes = static_cast<char*>(next.getData());
    const auto writeBE = [bytes](int offset, uint32_t v) {
        bytes[offset] = static_cast<char>(v >> 24); bytes[offset + 1] = static_cast<char>(v >> 16);
        bytes[offset + 2] = static_cast<char>(v >> 8); bytes[offset + 3] = static_cast<char>(v);
    };
    writeBE(20, static_cast<uint32_t>(next.getSize() - 24)); writeBE(172, static_cast<uint32_t>(payload.getSize()));
    auto* child = state.wrapper->getChildByName("IComponent"); child->deleteAllTextElements(); child->addTextElement(next.toBase64Encoding());
    juce::MemoryBlock host; juce::AudioProcessor::copyXmlToBinary(*state.wrapper, host);
    plugin->setStateInformation(host.getData(), static_cast<int>(host.getSize()));
    auto verified = readModoState(*plugin);
    for (const auto& name : applied) {
        auto actual = verified.tree.getProperty(name.toString()), expected = state.tree.getProperty(name.toString());
        const bool equal = modoValueMatches(actual, expected);
        check(equal, "MODO BASS did not retain preset property: " + name.toString());
    }
    juce::MemoryBlock finalState; plugin->getStateInformation(finalState);
    return obj({{"state_base64", finalState.toBase64Encoding()}, {"model", verified.tree.getProperty("BassModel")},
        {"play_style", verified.tree.getProperty("PlayStyle")}, {"properties_applied", applied.size()}, {"source", path(request["path"]).getFileName()}});
}
}
