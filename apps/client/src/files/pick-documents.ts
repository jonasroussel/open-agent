// Not in TypeScript's DOM lib yet.
declare global {
  interface Window {
    showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
  }
}

/**
 * Chrome on Android sends a file `<input>` through a chooser that, on some phones, offers only the camera and the photo
 * picker. `showOpenFilePicker` (Chrome Android 132+) opens the system file manager directly instead. No `types`: the
 * app checks each file's kind once picked. Without the API, or when it fails, `fallback` clicks the file input.
 */
export function pickDocuments(fallback: () => void, onPicked: (files: File[]) => void): void {
  if (!window.showOpenFilePicker) {
    fallback();
    return;
  }
  window
    .showOpenFilePicker({ multiple: true })
    .then((handles) => Promise.all(handles.map((handle) => handle.getFile())))
    .then(onPicked)
    .catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        fallback();
      }
    });
}
