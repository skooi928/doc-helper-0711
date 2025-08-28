package com.nezha.docs.dochelper_backend.service;

import java.io.File;

import org.springframework.stereotype.Component;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.loader.FileSystemDocumentLoader;
import dev.langchain4j.data.document.parser.TextDocumentParser;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import lombok.AllArgsConstructor;

@Component
@AllArgsConstructor
public class EmbeddingComponent {

  private final EmbeddingModel embeddingModel;
  private final EmbeddingStore<TextSegment> embeddingStore;

  public void loadDocuments() {
    // Implementation for loading and embedding documents
    /* Current implementation use and only load one document */
    String currentDir = System.getProperty("user.dir");
    String fileName = "README.md"; 
    Document document = FileSystemDocumentLoader.loadDocument(currentDir + File.separator + fileName, new TextDocumentParser());
    EmbeddingStoreIngestor embeddingStoreIngestor = EmbeddingStoreIngestor.builder()
        .documentSplitter(DocumentSplitters.recursive(300, 10))
        .embeddingModel(embeddingModel)
        .embeddingStore(embeddingStore)
        .build();

    embeddingStoreIngestor.ingest(document);
  }
}
