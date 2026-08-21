import { desc, eq, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { officeMailActivity } from "@/db/schema";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";
import { DrizzleLocationRepository } from "@/features/organization-locations/location-repository";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";

type DrizzleDatabase = typeof database;

export type OfficeLocationView = {
  id: string; label: string; venueName: string | null; address1: string | null; address2: string | null;
  city: string | null; region: string | null; postalCode: string | null; website: string | null; phone: string | null; email: string | null;
};
export type OfficeMailActivityView = {
  id: string; contactId: string | null; recipientName: string | null; address1: string | null; address2: string | null;
  city: string | null; region: string | null; postalCode: string | null; preparedAt: string | null; mailedAt: string | null; note: string | null;
};
export type OfficeContactPhoneView = { id: string | null; number: string; type: "mobile"|"office"|"alternate"|"unknown"; extension: string | null; label: string | null; primary: boolean };
export type OfficeProfileContactView = {
  id:string; name:string; firstName:string; lastName:string; role:string|null; jobTitle:string|null; isPrimary:boolean;
  phone:string|null; email:string|null; address1:string|null; address2:string|null; city:string|null; region:string|null; postalCode:string|null;
  locationName:string|null; phones:OfficeContactPhoneView[];
};
export type OfficeProfileView = {
  id:string;name:string;description:string|null;phone:string|null;address1:string|null;address2:string|null;city:string|null;region:string|null;postalCode:string|null;website:string|null;
  contacts:OfficeProfileContactView[];
  bookings:Array<{id:string;name:string;primaryContactId:string|null;city:string;region:string;startsAt:string|null;endsAt:string|null;status:string}>;
  notes:Array<{id:string;kind:string;body:string;occurredAt:string}>;locations:OfficeLocationView[];mailActivity:OfficeMailActivityView[];
};
function dateIso(value: Date|string|null|undefined){if(!value)return null;const date=value instanceof Date?value:new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString();}

type ContactSupplement={firstName:string;lastName:string;jobTitle:string|null;email:string|null;phone:string|null;address1:string|null;address2:string|null;city:string|null;region:string|null;postalCode:string|null;phones:OfficeContactPhoneView[]};
export function projectOfficeProfile(profile:any,supplemental:{description:string|null;locations:OfficeLocationView[];mailActivity:OfficeMailActivityView[];contactDetails?:Map<string,ContactSupplement>}):OfficeProfileView{
  return {id:profile.id,name:profile.place.name,description:supplemental.description,phone:profile.place.phone??null,address1:profile.place.address1??null,address2:profile.place.address2??null,city:profile.place.city??null,region:profile.place.region??null,postalCode:profile.place.postalCode??null,website:profile.place.website??null,
    contacts:(profile.contacts??[]).map((contact:any)=>{const detail=supplemental.contactDetails?.get(contact.id);const parts=String(contact.name??"").trim().split(/\s+/);return {id:contact.id,name:contact.name,firstName:detail?.firstName??parts[0]??"",lastName:detail?.lastName??parts.slice(1).join(" "),role:contact.role??null,jobTitle:detail?.jobTitle??null,isPrimary:Boolean(contact.isPrimary),phone:detail?.phone??contact.phone??null,email:detail?.email??contact.email??null,address1:detail?.address1??null,address2:detail?.address2??null,city:detail?.city??null,region:detail?.region??null,postalCode:detail?.postalCode??null,locationName:contact.locationName??null,phones:detail?.phones??[]};}),
    bookings:(profile.bookings??[]).map((booking:any)=>({id:booking.id,name:booking.name,primaryContactId:booking.primaryContactId??null,city:booking.city,region:booking.region,startsAt:dateIso(booking.startsAt),endsAt:dateIso(booking.endsAt),status:booking.status})),
    notes:(profile.notes??[]).map((note:any)=>({id:note.id,kind:note.kind,body:note.body,occurredAt:dateIso(note.occurredAt)??new Date(0).toISOString()})),locations:supplemental.locations,mailActivity:supplemental.mailActivity};
}

export class OfficeProfileService {
  constructor(private readonly database:DrizzleDatabase){}
  async listProfiles(input:{search:string;page:number}){const page=await new DrizzleOrganizationRepository(this.database).listOrganizations({search:input.search.trim().replace(/\s+/g," "),lastResort:"all",travelLegId:null,placeType:null,region:null,hasPhone:false,hasEmail:false,hasFollowUp:false,hasBooking:false,hasLocations:false,showMembers:false,includeRetired:false,page:input.page,pageSize:50});return {records:page.records.map((record)=>({id:record.id,name:record.name,city:record.city,region:record.region,primaryContactName:record.primaryContactName,contactCount:record.contactCount,bookingCount:record.bookingCount,locationCount:record.locationCount})),total:page.total,page:page.page,pageCount:page.pageCount};}
  async getProfile(profileId:string):Promise<OfficeProfileView|null>{
    const profile=await new DrizzleEventProfileRepository(this.database).getEventProfile(profileId);if(!profile)return null;
    let description:string|null=null;try{const result=await this.database.execute<{description:string|null}>(sql`select description from organizations where id = ${profileId}::uuid limit 1`);description=result.rows[0]?.description??null;}catch{description=null;}
    const contactRepository=new DrizzleContactRepository(this.database);const contactEntries=await Promise.all(profile.contacts.map(async(contact)=>{const detail=await contactRepository.getContactDetail(contact.id);if(!detail)return null;return [contact.id,{firstName:detail.contact.firstName,lastName:detail.contact.lastName,jobTitle:detail.contact.jobTitle,email:detail.contact.email,phone:detail.contact.phone,address1:detail.contact.address1,address2:detail.contact.address2,city:detail.contact.city,region:detail.contact.region,postalCode:detail.contact.postalCode,phones:(detail.phones??[]).map((phone:any)=>({id:phone.id??null,number:phone.number,type:phone.type,extension:phone.extension??null,label:phone.label??null,primary:Boolean(phone.primary)}))}] as const;}));
    const contactDetails=new Map(contactEntries.filter((entry):entry is NonNullable<typeof entry>=>entry!==null));
    const locationRepository=new DrizzleLocationRepository(this.database);const locationSummaries=await locationRepository.findByOrganization(profileId);const locationDetails=await Promise.all(locationSummaries.map((summary)=>locationRepository.findById(profileId,summary.id)));const locations:OfficeLocationView[]=locationDetails.flatMap((location)=>location?[{id:location.id,label:location.label,venueName:location.venueName,address1:location.address1,address2:location.address2,city:location.city,region:location.region,postalCode:location.postalCode,website:location.website,phone:location.phone,email:location.email}]:[]);
    const mailRows=await this.database.select().from(officeMailActivity).where(eq(officeMailActivity.organizationId,profileId)).orderBy(desc(officeMailActivity.mailedAt),desc(officeMailActivity.createdAt));const mailActivity:OfficeMailActivityView[]=mailRows.map((row)=>({id:row.id,contactId:row.contactId,recipientName:row.recipientName,address1:row.address1Snapshot,address2:row.address2Snapshot,city:row.citySnapshot,region:row.regionSnapshot,postalCode:row.postalCodeSnapshot,preparedAt:dateIso(row.preparedAt),mailedAt:dateIso(row.mailedAt),note:row.note}));
    return projectOfficeProfile(profile,{description,locations,mailActivity,contactDetails});
  }
}
