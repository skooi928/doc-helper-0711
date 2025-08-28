import * as cp from 'child_process';

export function runShellCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.execFile(command, args, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            }
            if (stderr) {
                resolve(stderr);
            }
            resolve(stdout);
        });
    });
}