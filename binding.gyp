{
  "targets": [
    {
      "target_name": "uber_mini_native",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [
        "backend/cpp/src/node_binding.cpp",
        "backend/cpp/src/graph.cpp",
        "backend/cpp/src/dijkstra.cpp",
        "backend/cpp/src/min_heap.cpp",
        "backend/cpp/src/driver_manager.cpp",
        "backend/cpp/src/ride_matcher.cpp",
        "backend/cpp/src/city_graph_generator.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "backend/cpp"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/std:c++17" ]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "defines": [ "_HAS_EXCEPTIONS=1" ]
        }],
        ["OS=='mac'", {
          "cflags": [ "-std=c++17", "-fexceptions" ],
          "cflags_cc": [ "-std=c++17", "-fexceptions" ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS=='linux'", {
          "cflags": [ "-std=c++17", "-fexceptions" ],
          "cflags_cc": [ "-std=c++17", "-fexceptions" ]
        }]
      ]
    }
  ]
}
