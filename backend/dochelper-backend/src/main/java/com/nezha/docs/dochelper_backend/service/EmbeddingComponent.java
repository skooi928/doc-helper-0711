package com.nezha.docs.dochelper_backend.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.Metadata;
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

  public void loadDocuments(MultipartFile file) throws IOException {
    // Implementation for loading and embedding documents
    /* Current implementation use and only load one document */
    // String currentDir = System.getProperty("user.dir");
    // String fileName = "README.md"; 
    // Document document = FileSystemDocumentLoader.loadDocument(currentDir + File.separator + fileName, new TextDocumentParser());
    // EmbeddingStoreIngestor embeddingStoreIngestor = EmbeddingStoreIngestor.builder()
    //     .documentSplitter(DocumentSplitters.recursive(300, 10))
    //     .embeddingModel(embeddingModel)
    //     .embeddingStore(embeddingStore)
    //     .build();

    // embeddingStoreIngestor.ingest(document);

    String text = new String(file.getBytes(), StandardCharsets.UTF_8);
    // build a Metadata object instead of using withMetadata(…)
    Metadata metadata = new Metadata();
    metadata.put("fileName", file.getOriginalFilename());
    Document doc = Document.from(text, metadata);

    EmbeddingStoreIngestor embeddingStoreIngestor = EmbeddingStoreIngestor.builder()
        .documentSplitter(DocumentSplitters.recursive(500, 50))
        .embeddingModel(embeddingModel)
        .embeddingStore(embeddingStore)
        .build();

    embeddingStoreIngestor.ingest(doc);
  }
}
