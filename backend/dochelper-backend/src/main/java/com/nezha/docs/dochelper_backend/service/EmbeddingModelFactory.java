package com.nezha.docs.dochelper_backend.service;

import org.springframework.stereotype.Service;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.huggingface.HuggingFaceEmbeddingModel;

@Service
public class EmbeddingModelFactory {
    
  public EmbeddingModel createEmbeddingModel(String huggingFaceToken) {
    if (huggingFaceToken == null || huggingFaceToken.trim().isEmpty()) {
      throw new IllegalArgumentException("HuggingFace token is required");
    }
    
    return HuggingFaceEmbeddingModel.builder()
        .accessToken(huggingFaceToken)
        .modelId("intfloat/multilingual-e5-base")
        .build();
  }
}