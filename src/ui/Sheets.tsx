import { CodeSheet } from './sheets/CodeSheet';
import { ExportSheet } from './sheets/ExportSheet';
import { GallerySheet } from './sheets/GallerySheet';
import { HelpSheet } from './sheets/HelpSheet';
import { MenuSheet } from './sheets/MenuSheet';
import { SettingsSheet } from './sheets/SettingsSheet';
import { TextSheet } from './sheets/TextSheet';
import { ChangesSheet } from './sheets/ChangesSheet';

export function Sheets() {
  return (
    <>
      <MenuSheet />
      <ExportSheet />
      <GallerySheet />
      <TextSheet />
      <HelpSheet />
      <SettingsSheet />
      <CodeSheet />
      <ChangesSheet />
    </>
  );
}
