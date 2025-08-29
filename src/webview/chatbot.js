(function () {
    const vscode = acquireVsCodeApi();

    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');
    const uploadButton = document.getElementById('upload-button');
    const fileInput = document.getElementById('file-input');
    const chatMessages = document.getElementById('chat-messages');
    const uploadedFilesContainer = document.getElementById('uploaded-files');
    
    let uploadedFiles = [];

    // Auto-resize textarea
    function adjustTextareaHeight() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    }

    // Enable/disable send button based on input
    function updateSendButton() {
        const hasText = chatInput.value.trim().length > 0;
        sendButton.disabled = !hasText;
    }

    // Handle file upload
    uploadButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        const files = Array.from(event.target.files);
        files.forEach(file => {
            uploadedFiles.push(file);
            addUploadedFile(file);
        });
        fileInput.value = ''; // Reset input
        updateUploadedFilesDisplay();
    });

    function addUploadedFile(file) {
        const fileElement = document.createElement('div');
        fileElement.className = 'uploaded-file';
        fileElement.innerHTML = `
            <span class="file-icon">📄</span>
            <span class="file-name" title="${file.name}">${file.name}</span>
            <button class="remove-file" data-filename="${file.name}">×</button>
        `;
        
        // Add event listener to the remove button
        const removeButton = fileElement.querySelector('.remove-file');
        removeButton.addEventListener('click', () => {
            removeFile(file.name);
        });
        
        uploadedFilesContainer.appendChild(fileElement);
    }

    function removeFile(fileName) {
        uploadedFiles = uploadedFiles.filter(file => file.name !== fileName);
        updateUploadedFilesDisplay();
    }

    // Make removeFile globally accessible
    window.removeFile = removeFile;

    function updateUploadedFilesDisplay() {
        uploadedFilesContainer.innerHTML = '';
        uploadedFiles.forEach(file => addUploadedFile(file));
        
        if (uploadedFiles.length > 0) {
            uploadedFilesContainer.classList.add('has-files');
        } else {
            uploadedFilesContainer.classList.remove('has-files');
        }
    }

    // Send message
    async function sendMessage() {
        const question = chatInput.value.trim();
        if (question) {
            // read each File as UTF-8 text before posting
            const filesPayload = await Promise.all(
                uploadedFiles.map(async file => ({
                name: file.name,
                content: await file.text() // wait for file content
                }))
            );

            vscode.postMessage({
                type: 'askQuestion',
                value: question,
                files: filesPayload
            });
            
            // Display the user's question immediately
            addMessage('user', question);
            
            // Show typing indicator
            addMessage('bot', 'Thinking...', true);
            
            // Clear the input field and uploaded files
            chatInput.value = '';
            uploadedFiles = [];
            updateUploadedFilesDisplay();
            adjustTextareaHeight();
            updateSendButton();
        }
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);

    chatInput.addEventListener('input', () => {
        adjustTextareaHeight();
        updateSendButton();
    });

    chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!sendButton.disabled) {
                sendMessage();
            }
        }
    });

    // Listen for messages from the extension
    let typingMessage = null;
    
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'addAIAnswer':
                // Remove typing indicator
                if (typingMessage) {
                    typingMessage.remove();
                    typingMessage = null;
                }
                addMessage('bot', message.value);
                break;
        }
    });

    // Add message to chat
    function addMessage(sender, text, isTyping = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');

        if (isTyping) {
            typingMessage = messageElement;
        }

        let formattedText = text;
        
        // Format code blocks
        if (!isTyping) {
            const codeBlockRegex = /```([\s\S]*?)```/g;
            formattedText = text.replace(codeBlockRegex, (match, code) => {
                return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
            });
            
            // Format inline code
            formattedText = formattedText.replace(/`([^`]+)`/g, '<code>$1</code>');
        }

        messageElement.innerHTML = formattedText;
        chatMessages.appendChild(messageElement);
        
        // Scroll to bottom
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 0);
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Initialize
    updateSendButton();
    adjustTextareaHeight();
}());