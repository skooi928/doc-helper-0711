package com.nezha.docs.dochelper_backend.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.nezha.docs.dochelper_backend.service.EmbeddingComponent;

import lombok.RequiredArgsConstructor;

import java.io.IOException;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;


@RestController
@RequiredArgsConstructor
@RequestMapping("/api/documents")
public class DocumentUploadController {
  private final EmbeddingComponent embeddingComponent;
  
  @PostMapping("/upload")
  public void uploadDocuments(@RequestParam("files") MultipartFile[] files, @RequestHeader("HF-Token") String huggingFaceToken) throws IOException {
      for (MultipartFile file : files) {
          // delegate to a new ingest method that takes the byte content
          embeddingComponent.loadDocuments(file, huggingFaceToken);
      }
      
  }
  
}
