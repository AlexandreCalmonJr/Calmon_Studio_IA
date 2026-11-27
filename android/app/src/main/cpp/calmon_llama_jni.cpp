#include <jni.h>
#include <string>
#include <fstream>

extern "C" JNIEXPORT jstring JNICALL
Java_com_calmonstudio_mobile_CalmonNativePlugin_nativeInspectGguf(
    JNIEnv* env,
    jobject /* this */,
    jstring modelPath,
    jstring prompt
) {
    const char* pathStr = env->GetStringUTFChars(modelPath, nullptr);
    const char* promptStr = env->GetStringUTFChars(prompt, nullptr);

    std::ifstream file(pathStr, std::ios::binary);
    std::string reply;
    if (!file.is_open()) {
        reply = "Modelo GGUF não encontrado no armazenamento interno.";
    } else {
        char magic[4] = {0};
        file.read(magic, 4);
        bool validGguf = (magic[0] == 'G' && magic[1] == 'G' && magic[2] == 'U' && magic[3] == 'F');
        reply = validGguf
            ? std::string("[NDK/JNI Local GGUF verificado] Prompt recebido: ") + promptStr
            : "Arquivo encontrado, mas cabeçalho GGUF inválido.";
    }

    env->ReleaseStringUTFChars(modelPath, pathStr);
    env->ReleaseStringUTFChars(prompt, promptStr);
    return env->NewStringUTF(reply.c_str());
}

