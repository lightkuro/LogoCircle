import { CodeSheet } from './sheets/CodeSheet';
import { ColorsSheet } from './sheets/ColorsSheet';
import { ExportSheet } from './sheets/ExportSheet';
import { GallerySheet } from './sheets/GallerySheet';
import { HelpSheet } from './sheets/HelpSheet';
import { MenuSheet } from './sheets/MenuSheet';
import { TextSheet } from './sheets/TextSheet';

export function Sheets() {
  return (
    <>
      <MenuSheet />
      <ColorsSheet />
      <ExportSheet />
      <GallerySheet />
      <TextSheet />
      <HelpSheet />
      <CodeSheet />
    </>
  );
}
