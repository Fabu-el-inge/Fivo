#include <iostream>
#include <string>
#include <vector>
#include <map>
#include "fivo.h"

// Helper to parse note string
FivoNote parse_note(std::string s) {
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

int main(int argc, char* argv[]) {
    // Basic Usage: ./fivo_demo [KEY] [ROOT]
    // Default: Key=C, Root=G (Dominant)
    
    FivoNote key = NOTE_C;
    FivoNote root = NOTE_G;
    FivoChordType type = CHORD_MAJOR;
    int inversion = 0;
    
    // Check for JSON flag
    bool jsonMode = false;
    bool contextMode = false;
    std::string arg1 = (argc > 1) ? argv[1] : "";
    
    if (arg1 == "--json") {
        jsonMode = true;
        if (argc > 2) key = parse_note(argv[2]);
        if (argc > 3) root = parse_note(argv[3]);
        // Simple optional arg parsing for inversion
        // Expected usage: --json KEY ROOT --inversion INV
        if (argc > 5) {
            std::string possibleFlag = argv[4];
            if (possibleFlag == "--inversion") {
                 try {
                     inversion = std::stoi(argv[5]);
                 } catch(...) {}
            }
        }
    } 
    else if (arg1 == "--context") {
        jsonMode = true; // Context implies JSON output for now
        contextMode = true;
        if (argc > 2) key = parse_note(argv[2]);
    }
    else {
        if (argc > 1) key = parse_note(argv[1]);
        if (argc > 2) root = parse_note(argv[2]);
    }
    
    if (contextMode) {
        std::cout << "{";
        std::cout << "\"key\": " << key << ",";
        std::cout << "\"map\": {";
        // Iterate all 12 semitones for major chords
        for (int i = 0; i < 12; ++i) {
            FivoNote n = static_cast<FivoNote>(i);
            FivoColorCode c = fivo_style_get_color(key, n);
            std::cout << "\"" << i << "\": " << c; // using int ID for safety as key
            if (i < 11) std::cout << ",";
        }
        std::cout << "},";
        std::cout << "\"minorMap\": {";
        // Iterate all 12 semitones for minor chords
        for (int i = 0; i < 12; ++i) {
            FivoNote n = static_cast<FivoNote>(i);
            FivoColorCode c = fivo_style_get_minor_color(key, n);
            std::cout << "\"" << i << "\": " << c;
            if (i < 11) std::cout << ",";
        }
        std::cout << "}";
        std::cout << "}" << std::endl;
        return 0;
    }
    
    // 1. Get Color from Style Manager
    FivoColorCode color = fivo_style_get_color(key, root);
    
    // 2. Get Chord Notes
    FivoChordResult chord = fivo_get_chord(root, type, inversion, 3);
    
    // 3. Circle Relations
    std::string relation = "OTHER";
    if (root == fivo_circle_get_dominant(key)) relation = "DOMINANT";
    else if (root == fivo_circle_get_subdominant(key)) relation = "SUBDOMINANT";
    else if (root == key) relation = "TONIC";
    else if (root == fivo_circle_get_relative_minor(key)) relation = "RELATIVE_MINOR";

    if (jsonMode) {
        std::cout << "{";
        std::cout << "\"key\": " << key << ",";
        std::cout << "\"root\": " << root << ",";
        std::cout << "\"color\": \"" << color_to_string(color, false) << "\","; // Simple string for now
        std::cout << "\"colorCode\": " << color << ",";
        std::cout << "\"relation\": \"" << relation << "\",";
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
