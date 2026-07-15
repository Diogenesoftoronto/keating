export function downloadFile(filename: string, content: string | Uint8Array, type: string) {
	const blobPart: BlobPart = typeof content === "string" ? content : Uint8Array.from(content).buffer;
	const blob = new Blob([blobPart], { type });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, content: string, type = "application/json;charset=utf-8") {
	downloadFile(filename, content, type);
}
