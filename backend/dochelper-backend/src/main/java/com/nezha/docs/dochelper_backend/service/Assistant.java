package com.nezha.docs.dochelper_backend.service;

import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

public interface Assistant {

  @SystemMessage(
    """
    You are a helpful assistant that helps people find information. If you don't know the answer, just say that you don't know. Do not try to make up an answer.
        """
  )
  String chat(@MemoryId int memoryId, @UserMessage String userMessage);
}