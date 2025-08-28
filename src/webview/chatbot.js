(function () {
    const vscode = acquireVsCodeApi();

    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');
    const chatMessages = document.getElementById('chat-messages');

    sendButton.addEventListener('click', () => {
        const question = chatInput.value;
        if (question) {
            vscode.postMessage({
                type: 'askQuestion',
                value: question
            });
            addMessage('user', question);
            chatInput.value = '';
        }
    });

    chatInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            sendButton.click();
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'addAnswer':
                addMessage('bot', message.value);
                break;
        }
    });

    function addMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');

        const codeBlockRegex = /```([\s\S]*?)```/g;
        let formattedText = text.replace(codeBlockRegex, (match, code) => {
            return `<pre><code>${escapeHtml(code)}</code></pre>`;
        });

        if (sender === 'user') {
            formattedText = `You: ${formattedText}`;
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