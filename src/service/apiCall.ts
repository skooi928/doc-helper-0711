export interface ChatResponse {
    response: string;
}

export async function askDocumentationQuestion(userId: number, question: string): Promise<string> {
    try {
        const response = await fetch('http://localhost:8080/api/qnachat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
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