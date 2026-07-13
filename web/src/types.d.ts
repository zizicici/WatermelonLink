interface Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  turnstile?: {
    render: (
      container: HTMLElement,
      options: {
        sitekey: string;
        action?: string;
        theme?: "auto" | "light" | "dark";
        language?: string;
        callback: (token: string) => void;
        "error-callback": () => void;
        "expired-callback": () => void;
        "unsupported-callback": () => void;
      }
    ) => string;
    remove: (widgetId: string) => void;
  };
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
