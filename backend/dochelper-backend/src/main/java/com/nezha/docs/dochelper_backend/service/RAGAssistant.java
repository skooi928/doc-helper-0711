package com.nezha.docs.dochelper_backend.service;

import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

public interface RAGAssistant {
  @SystemMessage(
    """
    You are a professional markdown documentation analyst. You will be provided with a markdown document and question by the user. Answer the question based on the document. If you don't know the answer, just say that you don't know. Do not try to make up an answer.
        """
  )
  String chat(@MemoryId int memoryId, @UserMessage String userMessage);
}
