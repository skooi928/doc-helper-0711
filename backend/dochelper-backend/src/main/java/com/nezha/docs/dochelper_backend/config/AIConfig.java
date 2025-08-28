package com.nezha.docs.dochelper_backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.googleai.GoogleAiGeminiChatModel;
import dev.langchain4j.service.AiServices;
import io.github.cdimascio.dotenv.Dotenv;

import com.nezha.docs.dochelper_backend.service.Assistant;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;

@Configuration
public class AIConfig {

  @Bean
  public Assistant assistant() {
    return AiServices.builder(Assistant.class)
        .chatModel(chatLanguageModel())
        .chatMemoryProvider(memoryId -> MessageWindowChatMemory.withMaxMessages(10))
        .build();
  }

  @Bean
  public ChatModel chatLanguageModel() {
    // Load environment variables from .env
    Dotenv dotenv = Dotenv.load();
    String apiKey = dotenv.get("GEMINI_AI_KEY");
    if (apiKey == null) {
      throw new IllegalStateException("API key not set");
    }

    return GoogleAiGeminiChatModel.builder()
        .apiKey(apiKey)
        .modelName("gemini-1.5-flash")
        .build();
  }
}
