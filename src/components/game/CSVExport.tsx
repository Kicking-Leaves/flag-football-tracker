"use client";

interface CSVExportProps {
  csv: string;
  filename: string;
  emailSubject?: string;
  emailBody?: string;
}

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function tryShareCSV(
  csv: string,
  filename: string,
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  try {
    const blob = new Blob([csv], { type: "text/csv" });
    const file = new File([blob], filename, { type: "text/csv" });
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
    };
    if (nav.canShare && !nav.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch {
    return false;
  }
}

export default function CSVExport({
  csv,
  filename,
  emailSubject,
  emailBody,
}: CSVExportProps) {
  async function handleDownload() {
    const shared = await tryShareCSV(csv, filename);
    if (!shared) triggerDownload(csv, filename);
  }

  function handleEmail() {
    const subject = encodeURIComponent(emailSubject ?? `Stats: ${filename}`);
    const body = encodeURIComponent(
      emailBody ?? `Game stats attached.\n\n${csv}`,
    );
    const a = document.createElement("a");
    a.href = `mailto:?subject=${subject}&body=${body}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={handleDownload}
        className="rounded-xl bg-gradient-to-r from-green-600 to-green-700 py-3 font-bold text-white shadow-lg"
      >
        Download CSV
      </button>
      <button
        type="button"
        onClick={handleEmail}
        className="rounded-xl bg-gradient-to-r from-orange-600 to-orange-700 py-3 font-bold text-white shadow-lg"
      >
        Email CSV
      </button>
    </div>
  );
}
