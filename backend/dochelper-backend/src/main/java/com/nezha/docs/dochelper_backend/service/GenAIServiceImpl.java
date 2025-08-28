package com.nezha.docs.dochelper_backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import com.nezha.docs.dochelper_backend.controller.dto.ChatRequest;

@Service
@RequiredArgsConstructor
public class GenAIServiceImpl implements GenAIService {

  private final Assistant assistant;

  @Override
  public String getResponse(ChatRequest request) {
    return assistant.chat(request.userId(), request.question());
  }

  // public String getResponseTutorial(ChatRequest request) {
  //   // Load environment variables from .env
  //   Dotenv dotenv = Dotenv.load();
  //   String apiKey = dotenv.get("GEMINI_AI_KEY");
  //   if (apiKey == null) {
  //     throw new IllegalStateException("API key not set");
  //   }

  //   // Add system message to the request
  //   List<ChatMessage> messages = new ArrayList<>();
  //   messages.add(SystemMessage.systemMessage("Respond in Chinese."));
  //   messages.add(UserMessage.userMessage(request.question()));

  //   // Build the model
  //   ChatModel model = GoogleAiGeminiChatModel.builder()
  //       .apiKey(apiKey)
  //       .modelName("gemini-1.5-flash")
  //       .build();

  //   return model.chat(messages.stream()
  //                                 .map(Object::toString) // Convert each ChatMessage to String
  //                                 .collect(Collectors.joining(" "))); // Join messages with space
  // }
}
