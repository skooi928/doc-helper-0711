import * as vscode from "vscode";

export interface ChatResponse {
    response: string;
}

export async function uploadDocuments(files: { name: string; content: string }[]) {
  const form = new FormData();
  for (const f of files) {
    // determine MIME type based on file extension
    const ext = f.name.split('.').pop()?.toLowerCase();
    // plain type if not md, js, ts, or tsx
    let mimeType = 'text/plain';
    switch (ext) {
      case 'md':
        mimeType = 'text/markdown';
        break;
      case 'js':
        mimeType = 'text/javascript';
        break;
      case 'ts':
      case 'tsx':
        mimeType = 'text/typescript';
        break;
    }
    form.append('files', new Blob([f.content], { type: mimeType }), f.name);
  }
  await fetch('https://doc-helper.onrender.com/api/documents/upload', { method: 'POST', body: form });
}

export async function askDocumentationQuestion(userId: number, question: string, files?:{name:string;content:string}[]): Promise<string> {
    const apiKey = vscode.workspace.getConfiguration('docHelper').get<string>('geminiApiKey');

    if (!apiKey) {
        throw new Error('Gemini API key is not configured. Please set it in VS Code settings.');
    }

    // If there is any file to upload, do it first
    if (files && files.length) {
        await uploadDocuments(files);
    }

    try {
        const response = await fetch('https://doc-helper.onrender.com/api/qnachat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'API-Key': apiKey 
            },
            body: JSON.stringify({ userId, question })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json() as any;
        // assuming the backend returns a JSON object with an "answer" property
        return data.response || '';
    } catch (error) {
        console.error('Error calling /api/qnachat:', error);
        throw error;
    }
}