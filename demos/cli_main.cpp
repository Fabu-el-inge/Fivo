#include <iostream>
#include <string>
#include <vector>
#include <map>
#include "fivo.h"

// Helper to parse note string (strips 'm' suffix for minor keys)
FivoNote parse_note(std::string s) {
    // Remove 'm' suffix if present (for minor keys like "Am", "Em")
    if (!s.empty() && s.back() == 'm') {
        s = s.substr(0, s.length() - 1);
    }
    if (s == "C") return NOTE_C;
    if (s == "C#" || s == "Db") return NOTE_CS;
    if (s == "D") return NOTE_D;
    if (s == "D#" || s == "Eb") return NOTE_DS;
    if (s == "E") return NOTE_E;
    if (s == "F") return NOTE_F;
    if (s == "F#" || s == "Gb") return NOTE_FS;
    if (s == "G") return NOTE_G;
    if (s == "G#" || s == "Ab") return NOTE_GS;
    if (s == "A") return NOTE_A;
    if (s == "A#" || s == "Bb") return NOTE_AS;
    if (s == "B") return NOTE_B;
    return NOTE_C; // Default
}

// Check if key string represents a minor key
bool is_minor_key(const std::string& s) {
    return !s.empty() && s.back() == 'm';
}

// Helper to parse style string
FivoStyle parse_style(std::string s) {
    if (s == "pop" || s == "Pop" || s == "POP") return STYLE_POP;
    if (s == "rock" || s == "Rock" || s == "ROCK") return STYLE_ROCK;
    if (s == "jazz" || s == "Jazz" || s == "JAZZ") return STYLE_JAZZ;
    if (s == "bossa" || s == "Bossa" || s == "BOSSA") return STYLE_BOSSA;
    return STYLE_POP; // Default
}

// Helper to stringify style
std::string style_to_string(FivoStyle s) {
    switch(s) {
        case STYLE_POP: return "Pop";
        case STYLE_ROCK: return "Rock";
        case STYLE_JAZZ: return "Jazz";
        case STYLE_BOSSA: return "Bossa";
        default: return "Pop";
    }
}

// Helper to stringify color
std::string color_to_string(FivoColorCode c, bool ansi = true) {
    if (!ansi) {
        switch(c) {
            case COLOR_GREEN: return "GREEN (Safe)";
            case COLOR_ORANGE: return "ORANGE (Tension)";
            case COLOR_RED: return "RED (Unsafe)";
            case COLOR_BLUE: return "BLUE (Active)";
            default: return "UNKNOWN";
        }
    }
    switch(c) {
        case COLOR_GREEN: return "\033[32mGREEN (Safe)\033[0m";
        case COLOR_ORANGE: return "\033[33mORANGE (Tension)\033[0m";
        case COLOR_RED: return "\033[31mRED (Unsafe)\033[0m";
        case COLOR_BLUE: return "\033[34mBLUE (Active)\033[0m";
        default: return "UNKNOWN";
    }
}

// Find argument value helper
std::string find_arg_value(int argc, char* argv[], const std::string& flag) {
    for (int i = 1; i < argc - 1; ++i) {
        if (std::string(argv[i]) == flag) {
            return std::string(argv[i + 1]);
        }
    }
    return "";
}

// Check if a flag exists in args
bool has_flag(int argc, char* argv[], const std::string& flag) {
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == flag) {
            return true;
        }
    }
    return false;
}

int main(int argc, char* argv[]) {
    // Basic Usage: ./fivo_demo [KEY] [ROOT]
    // JSON Usage: ./fivo_demo --json KEY ROOT [--inversion INV] [--style STYLE] [--minor]
    // Context Usage: ./fivo_demo --context KEY [--style STYLE]

    FivoNote key = NOTE_C;
    FivoNote root = NOTE_G;
    FivoChordType type = CHORD_MAJOR;
    int inversion = 0;
    FivoStyle style = STYLE_POP;
    bool isMinor = false;
    bool keyIsMinor = false;
    std::string keyStr = "C";

    // Check for flags
    bool jsonMode = false;
    bool contextMode = false;
    std::string arg1 = (argc > 1) ? argv[1] : "";

    // Parse --style flag from anywhere in args
    std::string styleArg = find_arg_value(argc, argv, "--style");
    if (!styleArg.empty()) {
        style = parse_style(styleArg);
    }

    // Parse --inversion flag from anywhere in args
    std::string invArg = find_arg_value(argc, argv, "--inversion");
    if (!invArg.empty()) {
        try {
            inversion = std::stoi(invArg);
        } catch(...) {}
    }

    // Parse --minor flag
    if (has_flag(argc, argv, "--minor")) {
        isMinor = true;
        type = CHORD_MINOR;
    }

    // Parse --power flag (power chord = root + fifth only)
    // Values: "on", "off", "auto" (default: off)
    bool isPower = false;
    std::string powerArg = find_arg_value(argc, argv, "--power");
    bool powerAuto = (powerArg == "auto");
    bool powerForced = has_flag(argc, argv, "--power") && powerArg.empty();

    if (powerForced || powerArg == "on") {
        isPower = true;
        type = CHORD_POWER5;
    }

    // Parse --fingers flag (1, 2, or 3 notes)
    int fingers = 3; // default full chord
    std::string fingersArg = find_arg_value(argc, argv, "--fingers");
    if (!fingersArg.empty()) {
        try {
            fingers = std::stoi(fingersArg);
            if (fingers < 1) fingers = 1;
            if (fingers > 3) fingers = 3;
        } catch(...) {}
    }

    // Parse --prev-notes flag (comma-separated MIDI values for voice leading)
    bool useVoiceLeading = false;
    std::vector<uint8_t> prevNotes;
    std::string prevArg = find_arg_value(argc, argv, "--prev-notes");
    if (!prevArg.empty()) {
        useVoiceLeading = true;
        // Parse comma-separated values
        size_t pos = 0;
        std::string token;
        std::string s = prevArg;
        while ((pos = s.find(',')) != std::string::npos) {
            token = s.substr(0, pos);
            try { prevNotes.push_back(std::stoi(token)); } catch(...) {}
            s.erase(0, pos + 1);
        }
        if (!s.empty()) {
            try { prevNotes.push_back(std::stoi(s)); } catch(...) {}
        }
    }

    if (arg1 == "--json") {
        jsonMode = true;
        if (argc > 2) {
            keyStr = argv[2];
            keyIsMinor = is_minor_key(keyStr);
            key = parse_note(keyStr);
        }
        if (argc > 3) root = parse_note(argv[3]);
    }
    else if (arg1 == "--context") {
        jsonMode = true;
        contextMode = true;
        if (argc > 2) {
            keyStr = argv[2];
            keyIsMinor = is_minor_key(keyStr);
            key = parse_note(keyStr);
        }
    }
    else {
        if (argc > 1) {
            keyStr = argv[1];
            keyIsMinor = is_minor_key(keyStr);
            key = parse_note(keyStr);
        }
        if (argc > 2) root = parse_note(argv[2]);
    }

    if (contextMode) {
        std::cout << "{";
        std::cout << "\"key\": " << key << ",";
        std::cout << "\"keyIsMinor\": " << (keyIsMinor ? "true" : "false") << ",";
        std::cout << "\"style\": \"" << style_to_string(style) << "\",";
        std::cout << "\"map\": {";
        // Iterate all 12 semitones for major chords with style
        for (int i = 0; i < 12; ++i) {
            FivoNote n = static_cast<FivoNote>(i);
            FivoColorCode c = keyIsMinor
                ? fivo_style_get_color_minor_key(key, n, style)
                : fivo_style_get_color_with_style(key, n, style);
            std::cout << "\"" << i << "\": " << c;
            if (i < 11) std::cout << ",";
        }
        std::cout << "},";
        std::cout << "\"minorMap\": {";
        // Iterate all 12 semitones for minor chords with style
        for (int i = 0; i < 12; ++i) {
            FivoNote n = static_cast<FivoNote>(i);
            FivoColorCode c = keyIsMinor
                ? fivo_style_get_minor_color_minor_key(key, n, style)
                : fivo_style_get_minor_color_with_style(key, n, style);
            std::cout << "\"" << i << "\": " << c;
            if (i < 11) std::cout << ",";
        }
        std::cout << "}";
        std::cout << "}" << std::endl;
        return 0;
    }

    // 1. Get Color from Style Manager with style
    // Consider both: chord type (isMinor) and key type (keyIsMinor)
    FivoColorCode color;
    if (keyIsMinor) {
        color = isMinor
            ? fivo_style_get_minor_color_minor_key(key, root, style)
            : fivo_style_get_color_minor_key(key, root, style);
    } else {
        color = isMinor
            ? fivo_style_get_minor_color_with_style(key, root, style)
            : fivo_style_get_color_with_style(key, root, style);
    }

    // Auto power chord: use power chord for ORANGE/RED chords (less clash)
    if (powerAuto && !isMinor && (color == COLOR_ORANGE || color == COLOR_RED)) {
        isPower = true;
        type = CHORD_POWER5;
    }

    // Jazz auto-voicing: upgrade to 7th/9th chords based on scale degree
    if (style == STYLE_JAZZ && !isPower) {
        int scaleDegree = (root - key + 12) % 12;
        if (isMinor) {
            // Minor chords in jazz → min9
            type = CHORD_MIN9;
        } else {
            // Major chords in jazz → depends on scale degree
            switch (scaleDegree) {
                case 0:  // I  → maj9
                case 5:  // IV → maj9
                    type = CHORD_MAJ9;
                    break;
                case 7:  // V  → dom9
                    type = CHORD_DOM9;
                    break;
                case 2:  // ii  (as major chord) → dom9 (secondary dominant)
                case 4:  // iii (as major chord) → dom9
                case 9:  // vi  (as major chord) → dom9
                    type = CHORD_DOM9;
                    break;
                default: // Everything else → dom9 (chromatic approach, subs, etc)
                    type = CHORD_DOM9;
                    break;
            }
        }
    }

    // Bossa auto-voicing: 7ths (not 9ths - more subtle than jazz)
    if (style == STYLE_BOSSA && !isPower) {
        int scaleDegree = (root - key + 12) % 12;
        if (isMinor) {
            type = CHORD_MIN7;
        } else {
            switch (scaleDegree) {
                case 0:  // I  → maj7
                case 5:  // IV → maj7
                    type = CHORD_MAJ7;
                    break;
                case 7:  // V  → dom7
                    type = CHORD_DOM7;
                    break;
                default: // Everything else → dom7
                    type = CHORD_DOM7;
                    break;
            }
        }
    }

    // 2. Get Chord Notes using extended function
    FivoChordOptions chordOpts = {0};
    chordOpts.fingers = fingers;
    chordOpts.use_voice_leading = useVoiceLeading ? 1 : 0;
    for (size_t i = 0; i < prevNotes.size() && i < 8; i++) {
        chordOpts.prev_notes[i] = prevNotes[i];
    }
    chordOpts.prev_count = (int)prevNotes.size();

    FivoChordResult chord = fivo_get_chord_ex(root, type, inversion, 3, &chordOpts);

    // 3. Circle Relations
    std::string relation = "OTHER";
    if (isMinor) {
        // Minor chord relations
        if (root == fivo_circle_get_relative_minor(key)) relation = "RELATIVE_MINOR";
        else if (root == static_cast<FivoNote>((key + 2) % 12)) relation = "SUPERTONIC_MINOR";  // ii
        else if (root == static_cast<FivoNote>((key + 4) % 12)) relation = "MEDIANT_MINOR";     // iii
        else if (root == static_cast<FivoNote>((key + 9) % 12)) relation = "SUBMEDIANT_MINOR";  // vi
        else if (root == key) relation = "PARALLEL_MINOR";               // i (Cm in C)
    } else {
        // Major chord relations
        if (root == fivo_circle_get_dominant(key)) relation = "DOMINANT";
        else if (root == fivo_circle_get_subdominant(key)) relation = "SUBDOMINANT";
        else if (root == key) relation = "TONIC";
        else if (root == fivo_circle_get_relative_minor(key)) relation = "RELATIVE_MINOR";
    }

    if (jsonMode) {
        std::cout << "{";
        std::cout << "\"key\": " << key << ",";
        std::cout << "\"root\": " << root << ",";
        std::cout << "\"isMinor\": " << (isMinor ? "true" : "false") << ",";
        std::cout << "\"isPower\": " << (isPower ? "true" : "false") << ",";
        std::cout << "\"fingers\": " << fingers << ",";
        std::cout << "\"style\": \"" << style_to_string(style) << "\",";
        std::cout << "\"color\": \"" << color_to_string(color, false) << "\",";
        std::cout << "\"colorCode\": " << color << ",";
        std::cout << "\"relation\": \"" << relation << "\",";
        std::cout << "\"fifthDistance\": " << fivo_circle_get_fifth_distance(key, root) << ",";
        std::cout << "\"notes\": [";
        for (int i = 0; i < chord.count; ++i) {
            std::cout << (int)chord.notes[i].midi_value;
            if (i < chord.count - 1) std::cout << ",";
        }
        std::cout << "]";
        std::cout << "}" << std::endl;
    } else {
        std::cout << "--- Fivo Core CLI Demo ---" << std::endl;
        std::cout << "Context Key: " << (argc > 1 ? argv[1] : "C") << std::endl;
        std::cout << "Target Chord Root: " << (argc > 2 ? argv[2] : "G") << std::endl;
        std::cout << "Style: " << style_to_string(style) << std::endl;
        std::cout << "Fifth Distance: " << fivo_circle_get_fifth_distance(key, root) << std::endl;
        std::cout << "Style Recommendation: " << color_to_string(color) << std::endl;

        std::cout << "MIDI Notes Generated: [ ";
        for (int i = 0; i < chord.count; ++i) {
            std::cout << (int)chord.notes[i].midi_value << " ";
        }
        std::cout << "]" << std::endl;

        std::cout << "Relation: " << relation << std::endl;
    }

    return 0;
}
