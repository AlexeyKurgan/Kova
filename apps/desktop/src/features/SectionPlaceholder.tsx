import { Boxes } from "lucide-react";
import type { Section } from "../lib/types";

export default function SectionPlaceholder({ title }: { title: Section }) {
  return (
    <section className="placeholder-screen">
      <h1>{title}</h1>
      <p className="subtitle">Раздел в разработке.</p>
      <div className="empty-panel placeholder-panel">
        <Boxes size={56} strokeWidth={1.1} className="placeholder-icon" />
        <h2 className="empty-title">Скоро здесь появится раздел «{title}»</h2>
        <p className="empty-text">
          Сейчас готов дизайн библиотеки ассетов. Остальные экраны подключим
          следующими.
        </p>
      </div>
    </section>
  );
}
