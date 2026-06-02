import { useEffect, useRef, useState } from "react";
import EasyMDE from "easymde";
import "easymde/dist/easymde.min.css";

import styles from "./RequirementMarkdownEditor.module.css";
import { rewriteRequirementAssetUrls } from "../../lib/requirement-asset-url.js";
import { Button } from "../ui/Button.js";

interface RequirementMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  projectId: string;
  disabled?: boolean;
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export function RequirementMarkdownEditor({
  value,
  onChange,
  onUploadImage,
  projectId,
  disabled = false
}: RequirementMarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<EasyMDE | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onUploadImageRef = useRef(onUploadImage);
  const projectIdRef = useRef(projectId);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    valueRef.current = value;
    if (editorRef.current && editorRef.current.value() !== value) {
      editorRef.current.value(value);
    }
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onUploadImageRef.current = onUploadImage;
  }, [onUploadImage]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    if (!textareaRef.current) return undefined;
    const editor = new EasyMDE({
      element: textareaRef.current,
      initialValue: valueRef.current,
      autoDownloadFontAwesome: true,
      forceSync: true,
      imageAccept: IMAGE_ACCEPT,
      imageMaxSize: 5 * 1024 * 1024,
      imageUploadFunction: (file, onSuccess, onError) => {
        void onUploadImageRef.current(file)
          .then(onSuccess)
          .catch((error) => {
            onError(error instanceof Error ? error.message : "图片上传失败");
          });
      },
      lineWrapping: true,
      minHeight: "360px",
      nativeSpellcheck: true,
      placeholder: "描述业务背景、目标和边界；支持 Markdown、粘贴截图、拖拽图片。",
      previewImagesInEditor: true,
      previewRender: function previewRender(plainText) {
        const rewritten = rewriteRequirementAssetUrls(plainText, projectIdRef.current);
        // EasyMDE 内置的 marked-based markdown 渲染
        return (this as unknown as { parent: { markdown: (text: string) => string } }).parent.markdown(
          rewritten
        );
      },
      spellChecker: false,
      status: false,
      toolbar: [
        "bold",
        "italic",
        "heading",
        "|",
        "quote",
        "unordered-list",
        "ordered-list",
        "|",
        "link",
        "image",
        "|",
        "preview",
        "side-by-side",
        "fullscreen"
      ],
      uploadImage: true
    });
    // 不默认开 side-by-side：EasyMDE 的 side-by-side 会联动 fullscreen，
    // 在 modal 内会接管整个视口、破坏 modal 布局。
    // 用户可手动点工具栏 ⊟ 切换 side-by-side 看图片预览。
    editor.codemirror.on("change", () => {
      const next = editor.value();
      valueRef.current = next;
      onChangeRef.current(next);
    });
    editorRef.current = editor;

    return () => {
      try {
        editor.toTextArea();
      } catch {
        // 忽略 cleanup 阶段的错误，避免阻塞重新挂载。
      }
      try {
        editor.cleanup();
      } catch {
        // EasyMDE 部分版本无 cleanup，安全忽略。
      }
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    editorRef.current?.codemirror.setOption("readOnly", disabled ? "nocursor" : false);
  }, [disabled]);

  const appendImageMarkdown = (path: string) => {
    const current = editorRef.current?.value() ?? valueRef.current;
    const separator = current.trim().length > 0 ? "\n\n" : "";
    const next = `${current}${separator}![](${path})`;
    valueRef.current = next;
    editorRef.current?.value(next);
    onChangeRef.current(next);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading(true);
    try {
      for (const file of images) {
        const path = await onUploadImageRef.current(file);
        appendImageMarkdown(path);
      }
    } catch {
      // 父层上传函数负责 toast；这里吞掉异常，避免文件选择器产生未处理 promise。
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.hint}>支持 Markdown 预览、粘贴截图、拖拽图片和本地上传。</span>
        <Button
          disabled={disabled || uploading}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          type="button"
          variant="secondary"
        >
          上传图片
        </Button>
        <input
          accept={IMAGE_ACCEPT}
          aria-label="选择需求图片"
          className={styles.fileInput}
          disabled={disabled || uploading}
          multiple
          onChange={(event) => {
            if (event.target.files) {
              void uploadFiles(event.target.files);
            }
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>
      <div className={styles.editor}>
        <textarea ref={textareaRef} />
      </div>
    </div>
  );
}
