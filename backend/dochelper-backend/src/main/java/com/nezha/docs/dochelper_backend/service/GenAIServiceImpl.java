package com.nezha.docs.dochelper_backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import com.nezha.docs.dochelper_backend.controller.dto.ChatRequest;

import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.googleai.GoogleAiGeminiChatModel;

@Service
@RequiredArgsConstructor
public class GenAIServiceImpl implements GenAIService {

  @Override
  public String getResponse(ChatRequest request) {
    ChatModel model = GoogleAiGeminiChatModel.builder()
        .apiKey(System.getenv("GEMINI_AI_KEY"))
        .modelName("gemini-1.5-flash")
        .build();
    return model.chat(request.question());
  }
}
