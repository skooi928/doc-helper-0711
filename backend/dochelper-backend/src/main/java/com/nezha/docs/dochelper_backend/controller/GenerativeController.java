package com.nezha.docs.dochelper_backend.controller;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

import com.nezha.docs.dochelper_backend.controller.dto.ChatRequest;
import com.nezha.docs.dochelper_backend.controller.dto.ChatResponse;
import com.nezha.docs.dochelper_backend.service.GenAIService;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class GenerativeController {
  
  private final GenAIService genAIService;

  @PostMapping(
    path     = "/qnachat",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
  )
  public ChatResponse getChatResponse(@RequestBody ChatRequest request, @RequestHeader("API-Key") String apiKey, @RequestHeader("HF-Token") String huggingFaceToken) {
    return new ChatResponse(genAIService.getResponse(request, apiKey, huggingFaceToken));
  }
  
}
