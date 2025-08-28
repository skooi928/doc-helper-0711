(function () {
    const vscode = acquireVsCodeApi();

    const logButton = document.getElementById('log-button');
    const commandOutput = document.getElementById('command-output');
    const logOutput = document.getElementById('log-output');

    logButton.addEventListener('click', () => {
        vscode.postMessage({
            type: 'runCommand',
            value: { command: 'git', args: ['log'] }
        });
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'commandOutput':
                if (Array.isArray(message.value)) { // Check if it's git log output
                    logOutput.innerHTML = ''; // Clear previous log
                    message.value.forEach(commit => {
                        const commitDiv = document.createElement('div');
                        commitDiv.classList.add('commit-entry');
                        commitDiv.innerHTML = `
                            <p><strong>Hash:</strong> ${commit.hash}</p>
                            <p><strong>Author:</strong> ${commit.author}</p>
                            <p><strong>Date:</strong> ${commit.date}</p>
                            <p><strong>Message:</strong> ${commit.message}</p>
                            <button class="revert-button" data-hash="${commit.hash}">Revert</button>
                            <hr>
                        `;
                        logOutput.appendChild(commitDiv);
                    });
                    // Add event listeners to new revert buttons
                    document.querySelectorAll('.revert-button').forEach(button => {
                        button.addEventListener('click', (e) => {
                            const hash = e.target.dataset.hash;
                            vscode.postMessage({
                                type: 'revertCommit',
                                value: { commitHash: hash }
                            });
                        });
                    });
                    commandOutput.textContent = ''; // Clear generic command output
                } else {
                    commandOutput.textContent = message.value;
                    logOutput.innerHTML = ''; // Clear log output
                }
                break;
        }
    });
}());