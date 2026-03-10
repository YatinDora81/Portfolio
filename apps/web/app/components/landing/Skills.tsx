'use client';

import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { skillIconMap } from '@/lib/icon-map';

interface SkillEntry {
  name: string;
  iconKey: string;
}

function SkillIcon({ skill }: { skill: SkillEntry }) {
  const icon = skillIconMap[skill.iconKey] || skillIconMap[skill.name];
  return (
    <div className="group/skill relative flex flex-col items-center gap-1.5">
      <div className="size-11 rounded-xl border border-border bg-card p-2 transition-all duration-200 group-hover/skill:scale-110 group-hover/skill:border-foreground/20 group-hover/skill:shadow-lg group-hover/skill:-translate-y-1">
        {icon}
      </div>
      <span className="text-[10px] text-secondary group-hover/skill:text-foreground transition-colors text-center leading-tight max-w-[56px]">
        {skill.name}
      </span>
    </div>
  );
}

export default function Skills({ skills }: { skills: SkillEntry[] }) {
  return (
    <section id="skills">
      <Container className="mt-20 animate-fade-in-blur animate-delay-4">
        <SectionHeading subHeading="Technical" heading="Skills" />
        <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-5">
          {skills.map((skill) => (
            <SkillIcon key={skill.name} skill={skill} />
          ))}
        </div>
      </Container>
    </section>
  );
}
