/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getShortcutSettings: () => Promise<{
      startCapture: string;
      startOcr: string;
      startTranslate: string;
      forceExit: string;
      translationSourceLang: 'auto' | 'zh' | 'en';
      translationTargetLang: 'zh' | 'en';
      defaultExportFormat: 'png' | 'jpg';
      closeAfterCopy: boolean;
      closeAfterSave: boolean;
      closeAfterPin: boolean;
      historyLimit: number;
      annotationColor: string;
      annotationStrokeWidth: number;
      annotationFontSize: number;
      toolbarOpacity: number;
      toolbarScale: number;
      ocrLanguages: 'eng' | 'chi_sim' | 'eng+chi_sim';
      pinWindowShadow: boolean;
      pinWindowOpacity: number;
    }>;
    updateShortcutSettings: (settings: {
      startCapture: string;
      startOcr: string;
      startTranslate: string;
      forceExit: string;
      translationSourceLang: 'auto' | 'zh' | 'en';
      translationTargetLang: 'zh' | 'en';
      defaultExportFormat: 'png' | 'jpg';
      closeAfterCopy: boolean;
      closeAfterSave: boolean;
      closeAfterPin: boolean;
      historyLimit: number;
      annotationColor: string;
      annotationStrokeWidth: number;
      annotationFontSize: number;
      toolbarOpacity: number;
      toolbarScale: number;
      ocrLanguages: 'eng' | 'chi_sim' | 'eng+chi_sim';
      pinWindowShadow: boolean;
      pinWindowOpacity: number;
    }) => Promise<
      | { status: 'success'; settings: {
        startCapture: string;
        startOcr: string;
        startTranslate: string;
        forceExit: string;
        translationSourceLang: 'auto' | 'zh' | 'en';
        translationTargetLang: 'zh' | 'en';
        defaultExportFormat: 'png' | 'jpg';
        closeAfterCopy: boolean;
        closeAfterSave: boolean;
        closeAfterPin: boolean;
        historyLimit: number;
        annotationColor: string;
        annotationStrokeWidth: number;
        annotationFontSize: number;
        toolbarOpacity: number;
        toolbarScale: number;
        ocrLanguages: 'eng' | 'chi_sim' | 'eng+chi_sim';
        pinWindowShadow: boolean;
        pinWindowOpacity: number;
      } }
      | { status: 'error'; message: string }
    >;
    getDesktopSources: () => Promise<Array<{ id: string; display_id: string }>>;
    getVisibleWindows: (displayId?: string) => Promise<Array<{
      id: number;
      ownerName: string;
      name: string;
      displayId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }>>;
    startCapture: (mode: 'region') => Promise<{ status: 'ok' }>;
    startOcrCapture: () => Promise<{ status: 'ok' }>;
    startTranslateCapture: () => Promise<{ status: 'ok' }>;
    closeCapture: () => void;
    saveScreenshot: (payload: { dataURL: string; format?: 'png' | 'jpg'; quality?: number }) => Promise<
      | { status: 'success'; filePath: string; format: 'png' | 'jpg' }
      | { status: 'cancelled' }
      | { status: 'error'; message: string }
    >;
    revealFileInFinder: (filePath: string) => Promise<
      | { status: 'success' }
      | { status: 'error'; message: string }
    >;
    recordCaptureHistory: (payload: {
      dataURL: string;
      action: 'copy' | 'save' | 'pin' | 'confirm';
      format: 'png' | 'jpg';
    }) => Promise<
      | { status: 'success'; item: {
        id: string;
        filePath: string;
        thumbnailPath: string;
        thumbnailDataURL: string;
        createdAt: number;
        action: 'copy' | 'save' | 'pin' | 'confirm';
        format: 'png' | 'jpg';
        width: number;
        height: number;
      } }
      | { status: 'error'; message: string }
    >;
    listCaptureHistory: () => Promise<Array<{
      id: string;
      filePath: string;
      thumbnailPath: string;
      thumbnailDataURL: string;
      createdAt: number;
      action: 'copy' | 'save' | 'pin' | 'confirm';
      format: 'png' | 'jpg';
      width: number;
      height: number;
    }>>;
    deleteCaptureHistory: (id: string) => Promise<
      | { status: 'success'; message?: undefined }
      | { status: 'error'; message?: string }
    >;
    clearCaptureHistory: () => Promise<
      | { status: 'success' }
      | { status: 'error'; message?: string }
    >;
    copyHistoryImage: (id: string) => Promise<
      | { status: 'success' }
      | { status: 'error'; message: string }
    >;
    createPinWindow: (payload: { dataURL: string }) => Promise<
      | { status: 'success'; pinId: string }
      | { status: 'error'; message: string }
    >;
    getPinWindowData: (pinId: string) => Promise<
      | { status: 'success'; dataURL: string }
      | { status: 'error'; message: string }
    >;
    setPinWindowOpacity: (opacity: number) => Promise<
      | { status: 'success' }
      | { status: 'error'; message: string }
    >;
    resizeCurrentWindow: (payload: { width: number; height: number }) => Promise<
      | { status: 'success' }
      | { status: 'error'; message: string }
    >;
    setCurrentWindowBounds: (payload: { x: number; y: number; width: number; height: number }) => Promise<
      | { status: 'success' }
      | { status: 'error'; message: string }
    >;
    moveCurrentWindow: (payload: { x: number; y: number }) => Promise<
      | { status: 'success' }
      | { status: 'error'; message: string }
    >;
    closeCurrentWindow: () => Promise<{ status: 'success' }>;
    translateText: (payload: {
      text: string;
      sourceLang: 'auto' | 'zh' | 'en';
      targetLang: 'zh' | 'en';
    }) => Promise<
      | { status: 'success'; text: string }
      | { status: 'error'; message: string }
    >;
    notifySelectionStart: () => void;
    updateSelectionState: (hasSelection: boolean) => void;
    clearOtherSelections: () => void;
    onClearSelection: (callback: () => void) => void;
    onCancelCaptureRequest: (callback: () => void) => void;
  };
}
