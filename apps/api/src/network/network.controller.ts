import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { tenantCan } from '@sampledge/contracts';
import { forbidden, notFound } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { meta } from '../auth/auth.controller.js';
import { RateLimitService } from '../redis/redis.module.js';
import { NetworkService } from './network.service.js';
import { StatusService } from './status.service.js';
import { CommunitiesService } from './communities.service.js';
import { NetworkPolicyService } from './network-policy.service.js';
import { NetworkGate } from './network-gate.js';

const kind = (k: string) => {
  if (k !== 'user' && k !== 'community') throw notFound('Follow target');
  return k;
};

/** Sampledge Network endpoints for network sessions (and the link endpoint for work sessions). */
@Controller('v1/network')
@UseGuards(AuthGuard)
export class NetworkController {
  constructor(
    private readonly network: NetworkService,
    private readonly statuses: StatusService,
    private readonly communities: CommunitiesService,
  ) {}

  // Work session → network session
  @Get('link')
  linkStatus(@Ctx() ctx: TenantContext) {
    return this.network.linkStatus(ctx);
  }
  @Post('link')
  @HttpCode(200)
  link(@Ctx() ctx: TenantContext, @Body() body: unknown, @Req() req: Request) {
    return this.network.link(ctx, body, meta(req));
  }

  // Profile and people
  @Get('me')
  me(@Ctx() ctx: TenantContext) {
    return this.network.me(ctx);
  }
  @Patch('me')
  updateMe(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.network.updateMe(ctx, body);
  }
  @Get('search')
  search(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.network.search(ctx, q);
  }
  @Get('people/:id')
  person(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.network.person(ctx, id);
  }

  // Connection requests
  @Get('requests')
  requests(@Ctx() ctx: TenantContext) {
    return this.network.listRequests(ctx);
  }
  @Post('requests')
  sendRequest(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.network.sendRequest(ctx, body);
  }
  @Post('requests/:id/respond')
  @HttpCode(200)
  respond(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.network.respond(ctx, id, body);
  }
  @Delete('requests/:id')
  @HttpCode(204)
  cancel(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.network.cancelRequest(ctx, id);
  }

  // Connections
  @Get('connections')
  connections(@Ctx() ctx: TenantContext) {
    return this.network.connections(ctx);
  }
  @Put('connections/:userId/circle')
  setCircle(@Ctx() ctx: TenantContext, @Param('userId') userId: string, @Body() body: unknown) {
    return this.network.setCircle(ctx, userId, body);
  }
  @Delete('connections/:userId')
  @HttpCode(204)
  removeConnection(@Ctx() ctx: TenantContext, @Param('userId') userId: string) {
    return this.network.removeConnection(ctx, userId);
  }

  // Follows (idempotent PUT/DELETE)
  @Get('follows')
  follows(@Ctx() ctx: TenantContext) {
    return this.network.follows(ctx);
  }
  @Put('follows/:type/:id')
  @HttpCode(204)
  follow(@Ctx() ctx: TenantContext, @Param('type') type: string, @Param('id') id: string) {
    return this.network.follow(ctx, kind(type), id);
  }
  @Delete('follows/:type/:id')
  @HttpCode(204)
  unfollow(@Ctx() ctx: TenantContext, @Param('type') type: string, @Param('id') id: string) {
    return this.network.unfollow(ctx, kind(type), id);
  }

  // Blocks and reports
  @Get('blocks')
  blocks(@Ctx() ctx: TenantContext) {
    return this.network.blocks(ctx);
  }
  @Put('blocks/:userId')
  @HttpCode(204)
  block(@Ctx() ctx: TenantContext, @Param('userId') userId: string) {
    return this.network.block(ctx, userId);
  }
  @Delete('blocks/:userId')
  @HttpCode(204)
  unblock(@Ctx() ctx: TenantContext, @Param('userId') userId: string) {
    return this.network.unblock(ctx, userId);
  }
  @Post('reports')
  report(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.network.report(ctx, body);
  }

  // Invites
  @Get('invites')
  invites(@Ctx() ctx: TenantContext) {
    return this.network.invites(ctx);
  }
  @Post('invites')
  createInvite(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.network.createInvite(ctx, body);
  }
  @Post('invites/:token/accept')
  @HttpCode(200)
  acceptInvite(@Ctx() ctx: TenantContext, @Param('token') token: string) {
    return this.network.acceptInvite(ctx, token);
  }

  // Status updates
  @Get('statuses')
  feed(@Ctx() ctx: TenantContext) {
    return this.statuses.feed(ctx);
  }
  @Post('status-media')
  media(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.statuses.mediaUpload(ctx, body);
  }
  @Post('statuses')
  createStatus(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.statuses.create(ctx, body);
  }
  @Put('statuses/:id/view')
  @HttpCode(204)
  view(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.statuses.view(ctx, id);
  }
  @Get('statuses/:id/viewers')
  viewers(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.statuses.viewers(ctx, id);
  }
  @Post('statuses/:id/reply')
  reply(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.statuses.reply(ctx, id, body);
  }
  @Delete('statuses/:id')
  @HttpCode(204)
  removeStatus(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.statuses.remove(ctx, id);
  }

  // Communities
  @Get('communities')
  myCommunities(@Ctx() ctx: TenantContext) {
    return this.communities.mine(ctx);
  }
  @Get('communities/discover')
  discover(@Ctx() ctx: TenantContext, @Query('q') q?: string) {
    return this.communities.discover(ctx, q);
  }
  @Post('communities')
  createCommunity(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.communities.create(ctx, body);
  }
  @Post('community-links/:token/join')
  @HttpCode(200)
  joinByLink(@Ctx() ctx: TenantContext, @Param('token') token: string) {
    return this.communities.joinByLink(ctx, token);
  }
  @Get('communities/:id')
  community(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.communities.get(ctx, id);
  }
  @Patch('communities/:id')
  updateCommunity(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.communities.update(ctx, id, body);
  }
  @Post('communities/:id/join')
  @HttpCode(200)
  join(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.communities.join(ctx, id);
  }
  @Post('communities/:id/leave')
  @HttpCode(204)
  leave(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.communities.leave(ctx, id);
  }
  @Post('communities/:id/decline')
  @HttpCode(204)
  decline(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.communities.declineInvite(ctx, id);
  }
  @Post('communities/:id/invite')
  @HttpCode(204)
  invite(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.communities.invite(ctx, id, body);
  }
  @Get('communities/:id/members')
  members(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.communities.members(ctx, id);
  }
  @Post('communities/:id/members/:userId/approve')
  @HttpCode(204)
  approve(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.communities.decide(ctx, id, userId, true);
  }
  @Post('communities/:id/members/:userId/deny')
  @HttpCode(204)
  deny(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.communities.decide(ctx, id, userId, false);
  }
  @Put('communities/:id/members/:userId/role')
  @HttpCode(204)
  role(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('userId') userId: string, @Body() body: unknown) {
    return this.communities.setRole(ctx, id, userId, body);
  }
  @Post('communities/:id/members/:userId/owner')
  @HttpCode(204)
  owner(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.communities.transferOwnership(ctx, id, userId);
  }
  @Delete('communities/:id/members/:userId')
  @HttpCode(204)
  removeMember(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('userId') userId: string, @Query('ban') ban?: string) {
    return this.communities.remove(ctx, id, userId, ban === 'true');
  }
  @Delete('communities/:id/bans/:userId')
  @HttpCode(204)
  unban(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.communities.unban(ctx, id, userId);
  }
  @Get('communities/:id/links')
  links(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.communities.links(ctx, id);
  }
  @Post('communities/:id/links')
  createLink(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.communities.createLink(ctx, id, body);
  }
  @Delete('communities/:id/links/:linkId')
  @HttpCode(204)
  revokeLink(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.communities.revokeLink(ctx, id, linkId);
  }
  @Post('communities/:id/groups')
  addGroup(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.communities.addGroup(ctx, id, body);
  }
  @Post('communities/:id/groups/:conversationId/join')
  @HttpCode(200)
  joinGroup(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('conversationId') cid: string) {
    return this.communities.joinGroup(ctx, id, cid);
  }
  @Post('communities/:id/groups/:conversationId/members')
  @HttpCode(200)
  addToGroup(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('conversationId') cid: string, @Body() body: unknown) {
    return this.communities.addToGroup(ctx, id, cid, body);
  }
  @Post('communities/:id/groups/:conversationId/leave')
  @HttpCode(204)
  leaveGroup(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('conversationId') cid: string) {
    return this.communities.leaveGroup(ctx, id, cid);
  }
  @Delete('communities/:id/groups/:conversationId')
  @HttpCode(204)
  archiveGroup(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('conversationId') cid: string) {
    return this.communities.archiveGroup(ctx, id, cid);
  }
}

/** No account needed: signup, public profiles and communities, invite previews. */
@Controller('v1/network/public')
export class NetworkPublicController {
  constructor(
    private readonly network: NetworkService,
    private readonly statuses: StatusService,
    private readonly communities: CommunitiesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async limit(req: Request) {
    await this.rateLimit.consume('guest_link', `network:${req.ip ?? 'unknown'}`);
  }

  @Post('signup')
  signup(@Body() body: unknown, @Req() req: Request) {
    return this.network.signup(body, meta(req));
  }

  @Get('profiles/:handle')
  async profile(@Param('handle') handle: string, @Req() req: Request) {
    await this.limit(req);
    const net = await this.network.net();
    const p = await net.network_profiles.findOne({ handle: handle.toLowerCase().replace(/^@/, '') });
    if (!p || p.privacy.profileVisibility !== 'public') throw notFound('Profile');
    return { profile: await this.network.toProfile(p), statuses: await this.statuses.publicOf(p) };
  }

  @Get('communities/:slug')
  async community(@Param('slug') slug: string, @Req() req: Request) {
    await this.limit(req);
    return this.communities.publicPage(slug);
  }

  @Get('invites/:token')
  async invite(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    return this.network.invitePreview(token);
  }

  @Get('community-links/:token')
  async link(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    return this.communities.linkPreview(token);
  }
}

/** Organization admins: allow or restrict Sampledge Network for their members. */
@Controller('v1/admin/network')
@UseGuards(AuthGuard)
export class NetworkAdminController {
  constructor(
    private readonly policy: NetworkPolicyService,
    private readonly gate: NetworkGate,
  ) {}

  @Get()
  view(@Ctx() ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'members.manage')) throw forbidden();
    return this.policy.view(ctx.tenantId);
  }

  @Put()
  async set(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    if (!tenantCan(ctx.role, 'members.manage')) throw forbidden();
    const r = await this.policy.set(ctx.tenantId, ctx.userId, body);
    this.gate.forget();
    return r;
  }
}
