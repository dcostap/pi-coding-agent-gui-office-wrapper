import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { showGlobalToast } from "../../hooks/useToast";
import { inlineCodeClass } from "../../ui/classes";
import { cn } from "../../utils/cn";

type MarkdownTone = "default" | "thinking" | "user";

type MarkdownContentProps = {
  markdown: string;
  tone?: MarkdownTone;
  className?: string;
};

function getToneTextClass(tone: MarkdownTone) {
  switch (tone) {
    case "thinking":
      return "text-[color:var(--muted-2)]/78 italic";
    case "user":
      return "text-[color:var(--text)]/94";
    default:
      return "text-[color:var(--text)]/92";
  }
}

function getToneStrongClass(tone: MarkdownTone) {
  switch (tone) {
    case "thinking":
      return "text-[color:var(--muted)]/88";
    case "user":
      return "text-[color:var(--text)]/96";
    default:
      return "text-[color:var(--text)]";
  }
}

function markdownUrlTransform(url: string) {
  if (url.startsWith("office-agent://")) {
    return url;
  }
  return defaultUrlTransform(url);
}

function MarkdownLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href, children, ...rest } = props;

  return (
    <a
      {...rest}
      href={href}
      className="text-[#81a2be] underline decoration-[rgba(129,162,190,0.45)] underline-offset-[3px] transition-colors hover:text-[#9bb8cf]"
      onClick={(event) => {
        if (!href) {
          return;
        }

        if (href === "office-agent://windows-sandbox/setup") {
          event.preventDefault();
          showGlobalToast({ message: "Solicitando permisos de administrador para configurar el sandbox… Se abrirá una ventana de PowerShell con el progreso.", tone: "info" });
          void window.piDesktop?.runWindowsSandboxSetup?.("setup")
            .then((result) => {
              if (result?.readyAfterRun) {
                showGlobalToast({ message: "Sandbox configurado correctamente. Ya puedes reintentar.", tone: "success" });
                return;
              }
              if (result?.ok === false) {
                showGlobalToast({ message: result.error ?? "No se pudo configurar el sandbox.", tone: "error" });
                return;
              }
              showGlobalToast({ message: "Configuración lanzada. Acepta UAC y espera a que la ventana indique que ha terminado.", tone: "info" });
            })
            .catch((error) => {
              showGlobalToast({
                message: error instanceof Error ? error.message : "No se pudo lanzar la configuración del sandbox.",
                tone: "error",
              });
            });
          return;
        }

        if (href.startsWith("http://") || href.startsWith("https://")) {
          event.preventDefault();
          void window.piDesktop?.openExternal?.(href);
        }
      }}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

function MarkdownPre({ children, ...props }: HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      {...props}
      className="m-0 overflow-x-auto rounded-[14px] border border-[rgba(128,128,128,0.34)] bg-[rgba(30,30,36,0.78)] px-3 py-2.5 font-mono text-[12.5px] leading-6 text-[#b5bd68]"
    >
      {children}
    </pre>
  );
}

function isLikelyLocalPath(value: string) {
  const trimmed = value.trim();
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || /^\/[\w .~/-]+/.test(trimmed);
}

function MarkdownInlineCode({ children }: { children?: ReactNode }) {
  const text = String(children ?? "").trim();
  const className = cn(inlineCodeClass, "bg-[rgba(138,190,183,0.14)] text-[#8abeb7]");

  if (text && isLikelyLocalPath(text)) {
    return (
      <button
        type="button"
        className={cn(
          className,
          "cursor-pointer border-0 text-left transition hover:bg-[rgba(138,190,183,0.22)] hover:text-[#a9d6d0]",
        )}
        onClick={() => void window.piDesktop?.openPath?.(text)}
        title="Open file"
      >
        {children}
      </button>
    );
  }

  return <code className={className}>{children}</code>;
}

export function MarkdownContent({ markdown, tone = "default", className }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-1.5 text-[14px] leading-[1.68] [overflow-wrap:anywhere] [&_code]:break-all [&_pre_code]:break-normal [&_pre_code]:text-inherit",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{
          p: ({ children }) => (
            <p className={cn("m-0 whitespace-pre-wrap break-words", getToneTextClass(tone))}>
              {children}
            </p>
          ),
          h1: ({ children }) => (
            <h1 className="m-0 text-[14px] font-semibold leading-[1.68] text-[#f0c674]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="m-0 text-[14px] font-semibold leading-[1.68] text-[#f0c674]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="m-0 text-[14px] font-semibold leading-[1.68] text-[#f0c674]">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="m-0 text-[14px] font-semibold leading-[1.68] text-[#f0c674]">
              {children}
            </h4>
          ),
          ul: ({ children }) => (
            <ul className="m-0 grid list-disc gap-0.5 pl-5 marker:text-[#8abeb7]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="m-0 grid list-decimal gap-0.5 pl-5 marker:text-[#8abeb7]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className={cn("min-w-0 break-words", getToneTextClass(tone))}>{children}</li>
          ),
          strong: ({ children }) => (
            <strong className={cn("font-semibold", getToneStrongClass(tone))}>{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: MarkdownLink,
          hr: () => <hr className="my-0.5 border-0 border-t border-[rgba(128,128,128,0.42)]" />,
          blockquote: ({ children }) => (
            <blockquote className="m-0 border-l border-[rgba(128,128,128,0.46)] pl-3 text-[#808080]">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-[12px] border border-[rgba(128,128,128,0.28)]">
              <table className="min-w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[rgba(255,255,255,0.03)]">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-[rgba(128,128,128,0.2)] px-3 py-2 font-medium text-[#f0c674]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className={cn(
                "border-t border-[rgba(128,128,128,0.14)] px-3 py-2 align-top",
                getToneTextClass(tone),
              )}
            >
              {children}
            </td>
          ),
          code: ({ children, className: codeClassName }) => {
            const text = String(children ?? "");
            const isBlock = Boolean(codeClassName) || text.includes("\n");
            if (isBlock) {
              return <code className={codeClassName}>{children}</code>;
            }

            return <MarkdownInlineCode>{children}</MarkdownInlineCode>;
          },
          pre: MarkdownPre,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
