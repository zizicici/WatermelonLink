interface Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  turnstile?: {
    render: (
      container: HTMLElement,
      options: {
        sitekey: string;
        action?: string;
        theme?: "auto" | "light" | "dark";
        callback: (token: string) => void;
        "error-callback": () => void;
        "expired-callback": () => void;
      }
    ) => string;
    remove: (widgetId: string) => void;
  };
}
