(function () {
    const vscode = acquireVsCodeApi();

    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');
    const chatMessages = document.getElementById('chat-messages');

    // Send the question from webview to extension
    sendButton.addEventListener('click', () => {
        const question = chatInput.value;
        if (question) {
            // Send the question to the extension
            vscode.postMessage({
                type: 'askQuestion',
                value: question
            });
            // Display the user's question immediately
            addMessage('user', question);
            // Clear the input field
            chatInput.value = '';
        }
    });

    // When entered, do the same as clicking the send button
    chatInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            sendButton.click();
        }
    });

    // Listen for messages from the extension (e.g., the AI answer)
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'addAIAnswer':
                addMessage('bot', message.value);
                break;
        }
    });

    // Logic of how to add the message to the chat window
    function addMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');

        const codeBlockRegex = /```([\s\S]*?)```/g;
        let formattedText = text.replace(codeBlockRegex, (match, code) => {
            return `<pre><code>${escapeHtml(code)}</code></pre>`;
        });

        if (sender === 'user') {
            formattedText = `You: ${formattedText}`;
        } else {
            formattedText = `Doc Helper: ${formattedText}`;
        }

        messageElement.innerHTML = formattedText;
        chatMessages.appendChild(messageElement);
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
}());