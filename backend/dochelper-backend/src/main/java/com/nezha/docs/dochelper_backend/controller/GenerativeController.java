package com.nezha.docs.dochelper_backend.controller;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import com.nezha.docs.dochelper_backend.controller.dto.ChatRequest;
import com.nezha.docs.dochelper_backend.controller.dto.ChatResponse;
import com.nezha.docs.dochelper_backend.service.GenAIService;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/qnachat")
public class GenerativeController {
  
  private final GenAIService genAIService;

  @PostMapping
  public ChatResponse getChatResponse(@RequestBody ChatRequest request) {
    return new ChatResponse(genAIService.getResponse(request));
  }
  
}
