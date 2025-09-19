package com.nezha.docs.dochelper_backend.service;

import com.nezha.docs.dochelper_backend.controller.dto.ChatRequest;

public interface GenAIService {
  String getResponse(ChatRequest request); 
}
