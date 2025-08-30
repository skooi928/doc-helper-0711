package com.nezha.docs.dochelper_backend.service;

import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

public interface RAGAssistant {
  @SystemMessage(
    """
      You are a professional software engineer. 
      Provide the answer with accuracy, precision and certainty. 
      Don't try to make up an answer.
        """
  )
  String chat(@MemoryId int memoryId, @UserMessage String userMessage);
}
