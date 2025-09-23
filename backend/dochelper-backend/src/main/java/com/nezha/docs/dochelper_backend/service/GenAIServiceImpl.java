package com.nezha.docs.dochelper_backend.service;

import lombok.RequiredArgsConstructor;

import java.util.List;

import org.springframework.stereotype.Service;

import com.nezha.docs.dochelper_backend.controller.dto.ChatRequest;

import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.rag.DefaultRetrievalAugmentor;
import dev.langchain4j.rag.RetrievalAugmentor;
import dev.langchain4j.rag.content.injector.DefaultContentInjector;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.store.embedding.EmbeddingStore;

@Service
@RequiredArgsConstructor
public class GenAIServiceImpl implements GenAIService {

  private final ChatModelFactory chatModelFactory;
  private final EmbeddingModelFactory embeddingModelFactory;
  private final EmbeddingStore<TextSegment> embeddingStore;

  @Override
  public String getResponse(ChatRequest request, String apiKey, String huggingFaceToken) {
    var chatModel = chatModelFactory.createChatModel(apiKey);
    var embeddingModel = embeddingModelFactory.createEmbeddingModel(huggingFaceToken);

    // Create RAG assistant with dynamic models
    var contentRetriever = EmbeddingStoreContentRetriever.builder()
        .embeddingModel(embeddingModel)
        .embeddingStore(embeddingStore)
        .maxResults(10)
        .minScore(0.6)
        .build();
        
    var contentInjector = DefaultContentInjector.builder()
        .metadataKeysToInclude(List.of("fileName", "index"))
        .build();

    RetrievalAugmentor retrievalAugmentor = DefaultRetrievalAugmentor.builder()
        .contentRetriever(contentRetriever)
        .contentInjector(contentInjector)
        .build();

    RAGAssistant assistant = AiServices.builder(RAGAssistant.class)
        .chatModel(chatModel)
        .retrievalAugmentor(retrievalAugmentor)
        .chatMemoryProvider(memoryId -> MessageWindowChatMemory.withMaxMessages(10))
        .build();

    return assistant.chat(request.userId(), request.question());
  }

  // public String getResponseTutorial(ChatRequest request) {
  //   // Load environment variables from .env
  //   Dotenv dotenv = Dotenv.load();
  //   String apiKey = dotenv.get("GEMINI_AI_KEY");
  //   if (apiKey == null) {
  //     throw new IllegalStateException("API key not set");
  //   }

  //   // Add system message to the request
  //   List<ChatMessage> messages = new ArrayList<>();
  //   messages.add(SystemMessage.systemMessage("Respond in Chinese."));
  //   messages.add(UserMessage.userMessage(request.question()));

  //   // Build the model
  //   ChatModel model = GoogleAiGeminiChatModel.builder()
  //       .apiKey(apiKey)
  //       .modelName("gemini-1.5-flash")
  //       .build();

  //   return model.chat(messages.stream()
  //                                 .map(Object::toString) // Convert each ChatMessage to String
  //                                 .collect(Collectors.joining(" "))); // Join messages with space
  // }
}
