import { Editor, InputRule, markInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";

globalThis.Tiptap = {
  Editor,
  InputRule,
  markInputRule,
  StarterKit,
  Placeholder,
  Markdown,
  Link,
  Image,
  Youtube,
};
