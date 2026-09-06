import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';

interface CameraScannerDialogProps {
  onClose: () => void;
  onScan: (value: string) => void;
}

export function CameraScannerDialog({ onClose, onScan }: CameraScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let disposed = false;
    let stopScanner: (() => void) | undefined;

    const stopVideo = () => {
      stopScanner?.();
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };

    const start = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('تشغيل الكاميرا يحتاج اتصال HTTPS ومتصفحاً حديثاً');
        setStarting(false);
        return;
      }

      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (disposed || !videoRef.current) return;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.DATA_MATRIX,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 100,
          delayBetweenScanSuccess: 500,
        });
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result) => {
            if (!result || scannedRef.current || disposed) return;
            scannedRef.current = true;
            stopScanner?.();
            onScanRef.current(result.getText());
          },
        );
        stopScanner = () => controls.stop();
        if (disposed) controls.stop();
        else setStarting(false);
      } catch (cause) {
        if (disposed) return;
        const name = cause instanceof DOMException ? cause.name : '';
        if (name === 'NotAllowedError') setError('لم يتم السماح باستخدام الكاميرا');
        else if (name === 'NotFoundError') setError('لم يتم العثور على كاميرا في هذا الجهاز');
        else if (name === 'NotReadableError') setError('الكاميرا مستخدمة في تطبيق آخر');
        else setError('تعذر تشغيل الكاميرا، تحقق من الأذونات وحاول مرة أخرى');
        setStarting(false);
        stopVideo();
      }
    };

    void start();
    return () => {
      disposed = true;
      stopVideo();
    };
  }, []);

  return (
    <Dialog open onClose={onClose} title="قراءة QR أو الباركود" className="max-w-lg">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-950">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!error && (
          <div className="pointer-events-none absolute inset-[16%] rounded-lg border-2 border-white/90 shadow-[0_0_0_999px_rgba(15,23,42,0.42)]" />
        )}
        {starting && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <LoaderCircle className="h-8 w-8 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-white">
            <Camera className="h-9 w-9" />
            <p className="text-sm font-bold">{error}</p>
          </div>
        )}
      </div>
      {!error && <p className="mt-3 text-center text-sm text-slate-500">وجّه الكاميرا نحو الرمز داخل الإطار</p>}
    </Dialog>
  );
}
