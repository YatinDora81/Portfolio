-- CreateEnum
CREATE TYPE "ScoreType" AS ENUM ('CGPA', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "ImageOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT', 'SQUARE');

-- CreateTable
CREATE TABLE "HeroTitle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "HeroTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeroSkillBadge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "HeroSkillBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialLink" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "detail" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AboutParagraph" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "AboutParagraph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "scoreType" "ScoreType",
    "score" TEXT,
    "scoreTotal" TEXT,
    "startYear" TEXT NOT NULL,
    "endYear" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "show" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceBullet" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "experienceId" TEXT NOT NULL,

    CONSTRAINT "ExperienceBullet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "github" TEXT,
    "live" TEXT,
    "image" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBullet" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ProjectBullet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "imageOrientation" "ImageOrientation" NOT NULL DEFAULT 'LANDSCAPE',
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "author" TEXT NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPurpose" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ContactPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ExperienceToSkill" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ExperienceToSkill_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProjectToSkill" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProjectToSkill_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Blog_slug_key" ON "Blog"("slug");

-- CreateIndex
CREATE INDEX "_ExperienceToSkill_B_index" ON "_ExperienceToSkill"("B");

-- CreateIndex
CREATE INDEX "_ProjectToSkill_B_index" ON "_ProjectToSkill"("B");

-- AddForeignKey
ALTER TABLE "ExperienceBullet" ADD CONSTRAINT "ExperienceBullet_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBullet" ADD CONSTRAINT "ProjectBullet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExperienceToSkill" ADD CONSTRAINT "_ExperienceToSkill_A_fkey" FOREIGN KEY ("A") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExperienceToSkill" ADD CONSTRAINT "_ExperienceToSkill_B_fkey" FOREIGN KEY ("B") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProjectToSkill" ADD CONSTRAINT "_ProjectToSkill_A_fkey" FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProjectToSkill" ADD CONSTRAINT "_ProjectToSkill_B_fkey" FOREIGN KEY ("B") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
