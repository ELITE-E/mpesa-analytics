"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActiveStatementCard } from "@/components/upload/active-statement-card";
import { PipelineSteps } from "@/components/upload/pipeline-steps";
import { ProceedCallToAction } from "@/components/upload/proceed-call-to-action";
import { StatementPasswordField } from "@/components/upload/statement-password-field";
import { UploadDropzone } from "@/components/upload/upload-dropzone";
import { dropzone, MAX_STATEMENT_BYTES, type StatementMetadata } from "@/content/upload";
import { setPendingUpload } from "@/lib/upload-flow";

// Holds the chosen statement and its password. Nothing is parsed yet: the
// statement engine reads the file on the processing screen. These checks only
// spare the user a pointless wait; the engine repeats them.
export function UploadWorkspace() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [statement, setStatement] = useState<StatementMetadata | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSelect(file: File) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return setError(dropzone.notPdfError);
    if (file.size > MAX_STATEMENT_BYTES) return setError(dropzone.tooLargeError);

    setError(null);
    setFile(file);
    setStatement({
      name: file.name,
      size: file.size,
      rows: null,
      period: null,
      isValidated: false,
    });
  }

  function handleRemove() {
    setFile(null);
    setStatement(null);
    setPassword("");
  }

  function handleProceed() {
    if (!file) return;
    setPendingUpload(file, password);
    router.push("/processing");
  }

  return (
    <>
      {statement && <ActiveStatementCard statement={statement} onRemove={handleRemove} />}
      <UploadDropzone
        title={statement ? dropzone.replaceTitle : dropzone.emptyTitle}
        onSelect={handleSelect}
        error={error}
      />
      {statement && <StatementPasswordField value={password} onChange={setPassword} />}
      <PipelineSteps />
      <ProceedCallToAction disabled={!file} onProceed={handleProceed} />
    </>
  );
}
