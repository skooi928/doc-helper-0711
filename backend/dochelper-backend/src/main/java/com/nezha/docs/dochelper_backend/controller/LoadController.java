package com.nezha.docs.dochelper_backend.controller;

import org.springframework.web.bind.annotation.RestController;

import com.nezha.docs.dochelper_backend.service.EmbeddingComponent;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
@RequiredArgsConstructor
public class LoadController {
  private final EmbeddingComponent embeddingComponent;
  
  @GetMapping("/loader/single")
  public void loadSingle() {
      embeddingComponent.loadDocuments();
  }
  
}
