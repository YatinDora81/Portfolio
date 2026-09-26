-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SiteVersion" AS ENUM ('v1', 'v2');

-- CreateEnum
CREATE TYPE "CatNapStyle" AS ENUM ('tooltip', 'ring', 'halo', 'pixel', 'moon', 'ticks', 'random', 'off');

-- CreateEnum
CREATE TYPE "ScoreType" AS ENUM ('CGPA', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "LiveProbeStatus" AS ENUM ('up', 'down');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ImageOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT', 'SQUARE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('UNREAD', 'READ', 'REPLIED', 'ARCHIVED', 'SPAM');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'SUB_ADMIN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('SAVE', 'SAVE_AND_PUBLISH', 'PUBLISH');

-- CreateEnum
CREATE TYPE "AuditSurface" AS ENUM ('staging', 'publish', 'script');

-- CreateEnum
CREATE TYPE "PublishState" AS ENUM ('NONE', 'OK', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditChangeKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'REORDER');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('FOLDER', 'QUESTION');

-- CreateEnum
CREATE TYPE "RevalidationScope" AS ENUM ('SITE', 'TAGS', 'PATHS', 'MIXED');

-- CreateEnum
CREATE TYPE "RevalidationTrigger" AS ENUM ('MANUAL', 'CONTENT_SAVE', 'SCHEDULED_PUBLISH', 'FLAG_CHANGE');

-- CreateEnum
CREATE TYPE "RevalidationStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('PAGEVIEW', 'SECTION_DWELL');

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "heroPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumeUrl" TEXT NOT NULL DEFAULT '',
    "projectsVersion" "SiteVersion" NOT NULL DEFAULT 'v2',
    "backgroundVersion" "SiteVersion" NOT NULL DEFAULT 'v1',
    "heroDotColor" TEXT NOT NULL DEFAULT '',
    "heroDotPulse" BOOLEAN NOT NULL DEFAULT true,
    "navbarLogo" TEXT NOT NULL DEFAULT '',
    "copyrightName" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "availabilityStatus" TEXT NOT NULL DEFAULT '',
    "availabilityDetail" TEXT NOT NULL DEFAULT '',
    "terrainStrength" INTEGER NOT NULL DEFAULT 50,
    "terrainVeil" INTEGER NOT NULL DEFAULT 50,
    "terrainCell" INTEGER NOT NULL DEFAULT 12,
    "terrainLevels" INTEGER NOT NULL DEFAULT 14,
    "terrainMinor" INTEGER NOT NULL DEFAULT 20,
    "terrainMajor" INTEGER NOT NULL DEFAULT 48,
    "terrainChannel" BOOLEAN NOT NULL DEFAULT true,
    "terrainInteractive" BOOLEAN NOT NULL DEFAULT true,
    "catNapStyle" "CatNapStyle" NOT NULL DEFAULT 'ticks',
    "catNapSeconds" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeroContent" (
    "id" TEXT NOT NULL,
    "version" "SiteVersion" NOT NULL,
    "intro" TEXT NOT NULL DEFAULT '',
    "tagline" TEXT NOT NULL DEFAULT '',
    "live" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeroTitle" (
    "id" TEXT NOT NULL,
    "version" "SiteVersion" NOT NULL DEFAULT 'v2',
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeroSkillBadge" (
    "id" TEXT NOT NULL,
    "version" "SiteVersion" NOT NULL DEFAULT 'v2',
    "skillId" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroSkillBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialLink" (
    "id" TEXT NOT NULL,
    "version" "SiteVersion",
    "name" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "detail" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AboutParagraph" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "startYear" INTEGER NOT NULL,
    "endYear" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "showInGrid" BOOLEAN NOT NULL DEFAULT true,
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
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "website" TEXT,
    "logoUrl" TEXT,
    "logoAssetId" TEXT,
    "visibleBullets" INTEGER NOT NULL DEFAULT 4,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
CREATE TABLE "ExperienceSkill" (
    "experienceId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ExperienceSkill_pkey" PRIMARY KEY ("experienceId","skillId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "github" TEXT,
    "live" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "logoAssetId" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
CREATE TABLE "ProjectSkill" (
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ProjectSkill_pkey" PRIMARY KEY ("projectId","skillId")
);

-- CreateTable
CREATE TABLE "ProjectImage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT,
    "externalUrl" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ProjectImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectHealth" (
    "projectId" TEXT NOT NULL,
    "status" "LiveProbeStatus",
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectHealth_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "imageOrientation" "ImageOrientation" NOT NULL DEFAULT 'LANDSCAPE',
    "image" TEXT,
    "coverAssetId" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPurpose" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT,
    "message" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'UNREAD',
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "spamScore" INTEGER NOT NULL DEFAULT 0,
    "spamReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "country" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "referrer" TEXT,
    "notificationMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReply" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "sentById" TEXT,
    "sentByName" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outboundMessageId" TEXT,
    "deliveryOk" BOOLEAN NOT NULL DEFAULT false,
    "deliveryError" TEXT,

    CONSTRAINT "MessageReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubProfile" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubYear" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" TEXT NOT NULL,
    "spikes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "GithubYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "otp" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "surface" "AuditSurface" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorRole" "AdminRole" NOT NULL,
    "publishState" "PublishState" NOT NULL DEFAULT 'NONE',
    "publishedAt" TIMESTAMP(3),
    "publishError" TEXT,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "AuditChangeKind" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "rowId" TEXT,
    "rowLabel" TEXT,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuditChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteNode" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "NoteKind" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "trashRoot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteAnswer" (
    "nodeId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "lastRevisedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteAnswer_pkey" PRIMARY KEY ("nodeId")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "blurDataUrl" TEXT,
    "altText" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'uploads',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RevalidationLog" (
    "id" TEXT NOT NULL,
    "scope" "RevalidationScope",
    "paths" TEXT[],
    "tags" TEXT[],
    "trigger" "RevalidationTrigger" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "status" "RevalidationStatus" NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevalidationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagState" (
    "tag" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TagState_pkey" PRIMARY KEY ("tag")
);

-- CreateTable
CREATE TABLE "AnalyticsSalt" (
    "dateKey" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSalt_pkey" PRIMARY KEY ("dateKey")
);

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "rawSource" TEXT,
    "rawMedium" TEXT,
    "rawCampaign" TEXT,
    "rawContent" TEXT,
    "rawTerm" TEXT,
    "messageId" TEXT,
    "referrerHost" TEXT,
    "landingPath" TEXT NOT NULL,
    "linkSlug" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageviews" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "path" TEXT NOT NULL,
    "section" TEXT,
    "label" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "campaign" TEXT,
    "destination" TEXT NOT NULL,
    "notes" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkClick" (
    "id" SERIAL NOT NULL,
    "linkId" TEXT NOT NULL,
    "visitorHash" TEXT,
    "country" TEXT,
    "deviceType" TEXT,
    "referrerHost" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStat" (
    "date" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "uniques" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "avgDurationMs" INTEGER NOT NULL DEFAULT 0,
    "medianMs" INTEGER NOT NULL DEFAULT 0,
    "reachedCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("date","dimension","key")
);

-- CreateTable
CREATE TABLE "RollupRun" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RollupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "key" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MaintenanceState" (
    "key" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastResult" TEXT,

    CONSTRAINT "MaintenanceState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeroContent_version_key" ON "HeroContent"("version");

-- CreateIndex
CREATE UNIQUE INDEX "HeroContent_live_key" ON "HeroContent"("live");

-- CreateIndex
CREATE INDEX "HeroTitle_version_sortOrder_idx" ON "HeroTitle"("version", "sortOrder");

-- CreateIndex
CREATE INDEX "HeroSkillBadge_version_sortOrder_idx" ON "HeroSkillBadge"("version", "sortOrder");

-- CreateIndex
CREATE INDEX "HeroSkillBadge_skillId_idx" ON "HeroSkillBadge"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "HeroSkillBadge_version_skillId_key" ON "HeroSkillBadge"("version", "skillId");

-- CreateIndex
CREATE INDEX "SocialLink_version_sortOrder_idx" ON "SocialLink"("version", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "Experience_logoAssetId_idx" ON "Experience"("logoAssetId");

-- CreateIndex
CREATE INDEX "ExperienceBullet_experienceId_sortOrder_idx" ON "ExperienceBullet"("experienceId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExperienceSkill_experienceId_sortOrder_idx" ON "ExperienceSkill"("experienceId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExperienceSkill_skillId_idx" ON "ExperienceSkill"("skillId");

-- CreateIndex
CREATE INDEX "Project_status_publishAt_idx" ON "Project"("status", "publishAt");

-- CreateIndex
CREATE INDEX "Project_status_publishedAt_idx" ON "Project"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Project_logoAssetId_idx" ON "Project"("logoAssetId");

-- CreateIndex
CREATE INDEX "ProjectBullet_projectId_sortOrder_idx" ON "ProjectBullet"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectSkill_projectId_sortOrder_idx" ON "ProjectSkill"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectSkill_skillId_idx" ON "ProjectSkill"("skillId");

-- CreateIndex
CREATE INDEX "ProjectImage_projectId_sortOrder_idx" ON "ProjectImage"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectImage_assetId_idx" ON "ProjectImage"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Blog_slug_key" ON "Blog"("slug");

-- CreateIndex
CREATE INDEX "Blog_status_publishAt_idx" ON "Blog"("status", "publishAt");

-- CreateIndex
CREATE INDEX "Blog_status_publishedAt_idx" ON "Blog"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Blog_coverAssetId_idx" ON "Blog"("coverAssetId");

-- CreateIndex
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_starred_createdAt_idx" ON "ContactMessage"("starred", "createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt");

-- CreateIndex
CREATE INDEX "MessageReply_messageId_sentAt_idx" ON "MessageReply"("messageId", "sentAt");

-- CreateIndex
CREATE INDEX "MessageReply_sentById_idx" ON "MessageReply"("sentById");

-- CreateIndex
CREATE UNIQUE INDEX "GithubProfile_handle_key" ON "GithubProfile"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "GithubYear_handle_year_key" ON "GithubYear"("handle", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_publishState_publishedAt_idx" ON "AuditEvent"("publishState", "publishedAt");

-- CreateIndex
CREATE INDEX "AuditChange_eventId_seq_idx" ON "AuditChange"("eventId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "NoteNode_path_key" ON "NoteNode"("path");

-- CreateIndex
CREATE INDEX "NoteNode_parentId_sortOrder_idx" ON "NoteNode"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "NoteNode_deletedAt_idx" ON "NoteNode"("deletedAt");

-- CreateIndex
CREATE INDEX "NoteNode_path_prefix_idx" ON "NoteNode"("path" text_pattern_ops);

-- CreateIndex
CREATE INDEX "NoteAnswer_confidence_idx" ON "NoteAnswer"("confidence");

-- CreateIndex
CREATE INDEX "NoteAnswer_tags_idx" ON "NoteAnswer" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_key_key" ON "MediaAsset"("key");

-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_uploadedById_idx" ON "MediaAsset"("uploadedById");

-- CreateIndex
CREATE INDEX "MediaAsset_key_prefix_idx" ON "MediaAsset"("key" text_pattern_ops);

-- CreateIndex
CREATE INDEX "FeatureFlag_updatedById_idx" ON "FeatureFlag"("updatedById");

-- CreateIndex
CREATE INDEX "RevalidationLog_createdAt_idx" ON "RevalidationLog"("createdAt");

-- CreateIndex
CREATE INDEX "RevalidationLog_status_createdAt_idx" ON "RevalidationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RevalidationLog_actorId_idx" ON "RevalidationLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSession_sessionHash_key" ON "AnalyticsSession"("sessionHash");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_idx" ON "AnalyticsSession"("startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_rawContent_startedAt_idx" ON "AnalyticsSession"("rawContent", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_slug_key" ON "TrackedLink"("slug");

-- CreateIndex
CREATE INDEX "TrackedLink_createdById_idx" ON "TrackedLink"("createdById");

-- CreateIndex
CREATE INDEX "LinkClick_linkId_createdAt_idx" ON "LinkClick"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "LinkClick_createdAt_idx" ON "LinkClick"("createdAt");

-- CreateIndex
CREATE INDEX "DailyStat_dimension_date_idx" ON "DailyStat"("dimension", "date");

-- CreateIndex
CREATE INDEX "RollupRun_date_idx" ON "RollupRun"("date");

-- CreateIndex
CREATE INDEX "RollupRun_createdAt_idx" ON "RollupRun"("createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowAt_idx" ON "RateLimitBucket"("windowAt");

-- AddForeignKey
ALTER TABLE "HeroSkillBadge" ADD CONSTRAINT "HeroSkillBadge_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceBullet" ADD CONSTRAINT "ExperienceBullet_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSkill" ADD CONSTRAINT "ExperienceSkill_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSkill" ADD CONSTRAINT "ExperienceSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBullet" ADD CONSTRAINT "ProjectBullet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImage" ADD CONSTRAINT "ProjectImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImage" ADD CONSTRAINT "ProjectImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHealth" ADD CONSTRAINT "ProjectHealth_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReply" ADD CONSTRAINT "MessageReply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReply" ADD CONSTRAINT "MessageReply_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubYear" ADD CONSTRAINT "GithubYear_handle_fkey" FOREIGN KEY ("handle") REFERENCES "GithubProfile"("handle") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditChange" ADD CONSTRAINT "AuditChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AuditEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteNode" ADD CONSTRAINT "NoteNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NoteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnswer" ADD CONSTRAINT "NoteAnswer_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "NoteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevalidationLog" ADD CONSTRAINT "RevalidationLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

