cmake_minimum_required(VERSION 3.22.1)
project("calmon_native_llm")

add_library(
    calmon_native_llm
    SHARED
    calmon_llama_jni.cpp
)

find_library(log-lib log)

target_link_libraries(
    calmon_native_llm
    ${log-lib}
)

