import { useEffect, useState } from 'react';
import { buildLabelSvg, type LabelOptions } from '@/lib/labels';
import type { Item } from '@/lib/types';
import { cn } from '@/lib/utils';

interface LabelPreviewProps {
  item: Item;
  options: LabelOptions;
  className?: string;
}

export function LabelPreview({ item, options, className }: LabelPreviewProps) {
  const [svg, setSvg] = useState('');
  const { template, logoUrl, brandName, printerName, offsetX, offsetY } = options;

  useEffect(() => {
    let active = true;
    void buildLabelSvg(item, { template, logoUrl, brandName, printerName, offsetX, offsetY }).then((value) => {
      if (active) setSvg(value);
    });
    return () => { active = false; };
  }, [item, template, logoUrl, brandName, printerName, offsetX, offsetY]);

  return (
    <div
      className={cn('aspect-[70/13] w-full overflow-hidden bg-white', className)}
      aria-label={`معاينة ملصق ${item.code}`}
    >
      {svg ? (
        <div className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-full w-full animate-pulse bg-slate-100" />
      )}
    </div>
  );
}
