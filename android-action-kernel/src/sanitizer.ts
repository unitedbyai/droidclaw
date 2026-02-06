/**
 * XML Sanitizer for Android Action Kernel.
 * Parses Android Accessibility XML and extracts interactive UI elements
 * with full state information and parent-child hierarchy context.
 */

import { XMLParser } from "fast-xml-parser";

export interface UIElement {
  id: string;
  text: string;
  type: string;
  bounds: string;
  center: [number, number];
  size: [number, number];
  clickable: boolean;
  editable: boolean;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  selected: boolean;
  scrollable: boolean;
  longClickable: boolean;
  password: boolean;
  hint: string;
  action: "tap" | "type" | "longpress" | "scroll" | "read";
  parent: string;
  depth: number;
}

/**
 * Compute a hash of element texts/ids for screen state comparison.
 */
export function computeScreenHash(elements: UIElement[]): string {
  const parts = elements.map(
    (e) => `${e.id}|${e.text}|${e.center[0]},${e.center[1]}|${e.enabled}|${e.checked}`
  );
  return parts.join(";");
}

/**
 * Parses Android Accessibility XML and returns a rich list of interactive elements.
 * Preserves state (enabled, checked, focused) and hierarchy context.
 */
export function getInteractiveElements(xmlContent: string): UIElement[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xmlContent);
  } catch {
    console.log("Warning: Error parsing XML. The screen might be loading.");
    return [];
  }

  const elements: UIElement[] = [];

  function walk(node: any, parentLabel: string, depth: number): void {
    if (!node || typeof node !== "object") return;

    if (node["@_bounds"]) {
      const isClickable = node["@_clickable"] === "true";
      const isLongClickable = node["@_long-clickable"] === "true";
      const isScrollable = node["@_scrollable"] === "true";
      const isEnabled = node["@_enabled"] !== "false"; // default true
      const isChecked = node["@_checked"] === "true";
      const isFocused = node["@_focused"] === "true";
      const isSelected = node["@_selected"] === "true";
      const isPassword = node["@_password"] === "true";

      const elementClass = node["@_class"] ?? "";
      const isEditable =
        elementClass.includes("EditText") ||
        elementClass.includes("AutoCompleteTextView") ||
        node["@_editable"] === "true";

      const text: string = node["@_text"] ?? "";
      const desc: string = node["@_content-desc"] ?? "";
      const resourceId: string = node["@_resource-id"] ?? "";
      const hint: string = node["@_hint"] ?? "";

      // Build a label for this node to use as parent context for children
      const typeName = elementClass.split(".").pop() ?? "";
      const nodeLabel = text || desc || resourceId.split("/").pop() || typeName;

      // Determine if this element should be included
      const isInteractive = isClickable || isEditable || isLongClickable || isScrollable;
      const hasContent = !!(text || desc);

      if (isInteractive || hasContent) {
        const bounds: string = node["@_bounds"];
        try {
          const coords = bounds
            .replace("][", ",")
            .replace("[", "")
            .replace("]", "")
            .split(",")
            .map(Number);

          const [x1, y1, x2, y2] = coords;
          const centerX = Math.floor((x1 + x2) / 2);
          const centerY = Math.floor((y1 + y2) / 2);
          const width = x2 - x1;
          const height = y2 - y1;

          // Skip zero-size elements (invisible)
          if (width <= 0 || height <= 0) {
            // still walk children
          } else {
            let suggestedAction: UIElement["action"];
            if (isEditable) suggestedAction = "type";
            else if (isLongClickable && !isClickable) suggestedAction = "longpress";
            else if (isScrollable && !isClickable) suggestedAction = "scroll";
            else if (isClickable) suggestedAction = "tap";
            else suggestedAction = "read";

            elements.push({
              id: resourceId,
              text: text || desc,
              type: typeName,
              bounds,
              center: [centerX, centerY],
              size: [width, height],
              clickable: isClickable,
              editable: isEditable,
              enabled: isEnabled,
              checked: isChecked,
              focused: isFocused,
              selected: isSelected,
              scrollable: isScrollable,
              longClickable: isLongClickable,
              password: isPassword,
              hint: hint,
              action: suggestedAction,
              parent: parentLabel,
              depth,
            });
          }
        } catch {
          // Skip malformed bounds
        }
      }

      // Recurse with updated parent label
      walkChildren(node, nodeLabel, depth + 1);
      return;
    }

    // No bounds on this node — just recurse
    walkChildren(node, parentLabel, depth);
  }

  function walkChildren(node: any, parentLabel: string, depth: number): void {
    if (node.node) {
      const children = Array.isArray(node.node) ? node.node : [node.node];
      for (const child of children) {
        walk(child, parentLabel, depth);
      }
    }
    if (node.hierarchy) {
      walk(node.hierarchy, parentLabel, depth);
    }
  }

  walk(parsed, "root", 0);
  return elements;
}
