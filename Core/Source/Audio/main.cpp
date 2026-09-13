#include "Engine.h"
#if defined(_WIN32)
// The Windows CRT's narrow argv may corrupt Japanese paths. Keep UTF-16 until conversion.
int wmain(int argc, wchar_t** argv) {
    std::vector<std::string> utf8;
    for (int i = 0; i < argc; ++i) utf8.push_back(juce::String(argv[i]).toStdString());
    std::vector<char*> args;
    for (auto& arg : utf8) args.push_back(arg.data());
    return aidaw::run(argc, args.data());
}
#else
int main(int argc, char** argv) { return aidaw::run(argc, argv); }
#endif
