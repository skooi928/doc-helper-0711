package com.nezha.docs.dochelper_backend.service;

import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

public interface RAGAssistant {
  @SystemMessage(
    """
      You are a helpful documentation assistant. Answer the following question based on the provided context. If you don't have enough information, say so clearly.
        """
  )
  String chat(@MemoryId int memoryId, @UserMessage String userMessage);
}
