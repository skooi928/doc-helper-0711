package com.nezha.docs.dochelper_backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.googleai.GoogleAiGeminiChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.huggingface.HuggingFaceEmbeddingModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.rag.DefaultRetrievalAugmentor;
import dev.langchain4j.rag.RetrievalAugmentor;
import dev.langchain4j.rag.content.injector.DefaultContentInjector;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.inmemory.InMemoryEmbeddingStore;

import com.nezha.docs.dochelper_backend.service.RAGAssistant;

import dev.langchain4j.data.segment.TextSegment;

@Configuration
public class AIConfig {

  /* Example for simple chat memory implementation, can refer to HERE */
  // @Bean
  // public Assistant assistant() {
  //   return AiServices.builder(Assistant.class)
  //       .chatModel(chatLanguageModel())
  //       .chatMemoryProvider(memoryId -> MessageWindowChatMemory.withMaxMessages(10)) [HERE]
  //       .build();
  // }

  /* Embedding files */
  @Bean
  public EmbeddingModel embeddingModel() {
    // // Load huggingface api from .env
    // Dotenv dotenv = Dotenv.load();
    // String huggingToken = dotenv.get("HUGGINGFACE_TOKEN");
    // if (huggingToken == null) {
    //   throw new IllegalStateException("API key not set");
    // }
    // return HuggingFaceEmbeddingModel.builder()
    //     .accessToken(huggingToken)
    //     .modelId("intfloat/multilingual-e5-base")
    //     .build();
    return OpenAiEmbeddingModel.builder()
        .baseUrl("http://localhost:8081")
        .apiKey("not-needed")
        .modelName("intfloat/multilingual-e5-base")
        .build();
  }

  /* Store the embedded file */
  @Bean
  public EmbeddingStore<TextSegment> embeddingStore() {
    // Implementation for embedding store, e.g., using in-memory or database-backed store
    // here we use an in-memory store for simplicity
    // will change to pgvector store later
    return new InMemoryEmbeddingStore<>();
  }

  @Bean
  public RetrievalAugmentor retrievalAugmentor() {
    var contentRetriever = EmbeddingStoreContentRetriever.builder()
        .embeddingModel(embeddingModel())
        .embeddingStore(embeddingStore())
        .maxResults(10)
        .minScore(0.6)
        .build();
    
    var contentInjector = DefaultContentInjector.builder()
        .metadataKeysToInclude(List.of("fileName", "index"))
        .build();

    return DefaultRetrievalAugmentor.builder()
        .contentRetriever(contentRetriever)
        .contentInjector(contentInjector)
        .build();
  }
}
