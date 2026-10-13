export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      address_observations: {
        Row: {
          canvasser_id: string
          client_event_id: string
          house_number: string
          id: string
          observed_at: string
          uprn: number
        }
        Insert: {
          canvasser_id: string
          client_event_id: string
          house_number: string
          id?: string
          observed_at: string
          uprn: number
        }
        Update: {
          canvasser_id?: string
          client_event_id?: string
          house_number?: string
          id?: string
          observed_at?: string
          uprn?: number
        }
        Relationships: [
          {
            foreignKeyName: "address_observations_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_observations_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "address_observations_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_members: {
        Row: {
          assignment_id: string
          canvasser_id: string
          left_at: string | null
          route_position_at: string | null
          route_position_m: number | null
        }
        Insert: {
          assignment_id: string
          canvasser_id: string
          left_at?: string | null
          route_position_at?: string | null
          route_position_m?: number | null
        }
        Update: {
          assignment_id?: string
          canvasser_id?: string
          left_at?: string | null
          route_position_at?: string | null
          route_position_m?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_members_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_members_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_prop_completion"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "assignment_members_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          closed_at: string | null
          closed_reason: string | null
          counts_for_rotation: boolean
          created_at: string
          created_by: string | null
          entry_vertex_index: number
          id: string
          route_geom: unknown
          route_length_m: number | null
          route_source_id: string | null
          route_stranded_count: number
          route_variant_key: string | null
          slot: string
          started_at: string | null
          sweep_direction: string
          territory_id: string
          uprn_snapshot: number[]
          visit_number: number
          work_date: string
        }
        Insert: {
          closed_at?: string | null
          closed_reason?: string | null
          counts_for_rotation?: boolean
          created_at?: string
          created_by?: string | null
          entry_vertex_index: number
          id?: string
          route_geom?: unknown
          route_length_m?: number | null
          route_source_id?: string | null
          route_stranded_count?: number
          route_variant_key?: string | null
          slot: string
          started_at?: string | null
          sweep_direction: string
          territory_id: string
          uprn_snapshot: number[]
          visit_number: number
          work_date: string
        }
        Update: {
          closed_at?: string | null
          closed_reason?: string | null
          counts_for_rotation?: boolean
          created_at?: string
          created_by?: string | null
          entry_vertex_index?: number
          id?: string
          route_geom?: unknown
          route_length_m?: number | null
          route_source_id?: string | null
          route_stranded_count?: number
          route_variant_key?: string | null
          slot?: string
          started_at?: string | null
          sweep_direction?: string
          territory_id?: string
          uprn_snapshot?: number[]
          visit_number?: number
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_route_source_id_fkey"
            columns: ["route_source_id"]
            isOneToOne: false
            referencedRelation: "territory_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      building_footprints: {
        Row: {
          building: string | null
          fetched_at: string
          geom: unknown
          height_m: number
          osm_id: number
        }
        Insert: {
          building?: string | null
          fetched_at?: string
          geom: unknown
          height_m: number
          osm_id: number
        }
        Update: {
          building?: string | null
          fetched_at?: string
          geom?: unknown
          height_m?: number
          osm_id?: number
        }
        Relationships: []
      }
      crm_callbacks: {
        Row: {
          call_back_on: string | null
          called_at: string
          canvasser_id: string
          client_event_id: string
          created_at: string
          crm_id: string
          id: string
          result: string
        }
        Insert: {
          call_back_on?: string | null
          called_at: string
          canvasser_id: string
          client_event_id: string
          created_at?: string
          crm_id: string
          id?: string
          result: string
        }
        Update: {
          call_back_on?: string | null
          called_at?: string
          canvasser_id?: string
          client_event_id?: string
          created_at?: string
          crm_id?: string
          id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_callbacks_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_callbacks_crm_id_fkey"
            columns: ["crm_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["crm_id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          address_line: string | null
          alt_phone: string | null
          best_time: string | null
          crm_id: string
          description: string | null
          phone: string | null
          product_interest: string | null
          purge_after: string
          result_note: string | null
          surname: string | null
          synced_at: string
          title: string | null
        }
        Insert: {
          address_line?: string | null
          alt_phone?: string | null
          best_time?: string | null
          crm_id: string
          description?: string | null
          phone?: string | null
          product_interest?: string | null
          purge_after: string
          result_note?: string | null
          surname?: string | null
          synced_at?: string
          title?: string | null
        }
        Update: {
          address_line?: string | null
          alt_phone?: string | null
          best_time?: string | null
          crm_id?: string
          description?: string | null
          phone?: string | null
          product_interest?: string | null
          purge_after?: string
          result_note?: string | null
          surname?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_crm_id_fkey"
            columns: ["crm_id"]
            isOneToOne: true
            referencedRelation: "crm_leads"
            referencedColumns: ["crm_id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          appointment_at: string | null
          branch: string
          callback_reason: string | null
          canvasser_first_name: string | null
          crm_created_at: string
          crm_id: string
          crm_modified_at: string
          first_synced_at: string
          lead_no: string | null
          location: unknown
          match_tier: string
          postcode: string | null
          postcode_sector: string | null
          sale_amount: number | null
          status: string | null
          status_raw: string | null
          synced_at: string
          uprn: number | null
        }
        Insert: {
          appointment_at?: string | null
          branch: string
          callback_reason?: string | null
          canvasser_first_name?: string | null
          crm_created_at: string
          crm_id: string
          crm_modified_at: string
          first_synced_at?: string
          lead_no?: string | null
          location?: unknown
          match_tier: string
          postcode?: string | null
          postcode_sector?: string | null
          sale_amount?: number | null
          status?: string | null
          status_raw?: string | null
          synced_at?: string
          uprn?: number | null
        }
        Update: {
          appointment_at?: string | null
          branch?: string
          callback_reason?: string | null
          canvasser_first_name?: string | null
          crm_created_at?: string
          crm_id?: string
          crm_modified_at?: string
          first_synced_at?: string
          lead_no?: string | null
          location?: unknown
          match_tier?: string
          postcode?: string | null
          postcode_sector?: string | null
          sale_amount?: number | null
          status?: string | null
          status_raw?: string | null
          synced_at?: string
          uprn?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "crm_leads_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      crm_status_map: {
        Row: {
          crm_value: string
          note: string | null
          status: string
        }
        Insert: {
          crm_value: string
          note?: string | null
          status: string
        }
        Update: {
          crm_value?: string
          note?: string | null
          status?: string
        }
        Relationships: []
      }
      crm_sync_runs: {
        Row: {
          app_leads_ambiguous: number | null
          app_leads_linked: number | null
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          match_counts: Json | null
          max_modified_seen: string | null
          modified_since: string | null
          rows_inserted: number | null
          rows_seen: number | null
          rows_skipped: number | null
          rows_unchanged: number | null
          rows_updated: number | null
          started_at: string
          unknown_statuses: Json | null
        }
        Insert: {
          app_leads_ambiguous?: number | null
          app_leads_linked?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          match_counts?: Json | null
          max_modified_seen?: string | null
          modified_since?: string | null
          rows_inserted?: number | null
          rows_seen?: number | null
          rows_skipped?: number | null
          rows_unchanged?: number | null
          rows_updated?: number | null
          started_at?: string
          unknown_statuses?: Json | null
        }
        Update: {
          app_leads_ambiguous?: number | null
          app_leads_linked?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          match_counts?: Json | null
          max_modified_seen?: string | null
          modified_since?: string | null
          rows_inserted?: number | null
          rows_seen?: number | null
          rows_skipped?: number | null
          rows_unchanged?: number | null
          rows_updated?: number | null
          started_at?: string
          unknown_statuses?: Json | null
        }
        Relationships: []
      }
      door_footprints: {
        Row: {
          computed_at: string
          doors_at_position: number
          geom: unknown
          height_m: number
          osm_id: number
          shared: boolean
          uprn: number
        }
        Insert: {
          computed_at?: string
          doors_at_position: number
          geom: unknown
          height_m: number
          osm_id: number
          shared: boolean
          uprn: number
        }
        Update: {
          computed_at?: string
          doors_at_position?: number
          geom?: unknown
          height_m?: number
          osm_id?: number
          shared?: boolean
          uprn?: number
        }
        Relationships: [
          {
            foreignKeyName: "door_footprints_osm_id_fkey"
            columns: ["osm_id"]
            isOneToOne: false
            referencedRelation: "building_footprints"
            referencedColumns: ["osm_id"]
          },
          {
            foreignKeyName: "door_footprints_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "door_footprints_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: true
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      knock_events: {
        Row: {
          assignment_id: string
          canvasser_id: string
          client_event_id: string
          id: string
          notes: string | null
          occurred_at: string
          origin: string
          outcome: string
          sequence_position: number | null
          synced_at: string
          uprn: number
        }
        Insert: {
          assignment_id: string
          canvasser_id: string
          client_event_id: string
          id?: string
          notes?: string | null
          occurred_at: string
          origin?: string
          outcome: string
          sequence_position?: number | null
          synced_at?: string
          uprn: number
        }
        Update: {
          assignment_id?: string
          canvasser_id?: string
          client_event_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          origin?: string
          outcome?: string
          sequence_position?: number | null
          synced_at?: string
          uprn?: number
        }
        Relationships: [
          {
            foreignKeyName: "knock_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knock_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_prop_completion"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "knock_events_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knock_events_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "knock_events_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      leads: {
        Row: {
          booked_for: string | null
          canvasser_id: string
          client_event_id: string
          crm_last_synced_at: string | null
          crm_ref: string | null
          id: string
          is_immediate: boolean
          knock_event_id: string
          notes: string | null
          status: string
          status_set_at: string | null
          status_set_by: string | null
          uprn: number
        }
        Insert: {
          booked_for?: string | null
          canvasser_id: string
          client_event_id: string
          crm_last_synced_at?: string | null
          crm_ref?: string | null
          id?: string
          is_immediate?: boolean
          knock_event_id: string
          notes?: string | null
          status?: string
          status_set_at?: string | null
          status_set_by?: string | null
          uprn: number
        }
        Update: {
          booked_for?: string | null
          canvasser_id?: string
          client_event_id?: string
          crm_last_synced_at?: string | null
          crm_ref?: string | null
          id?: string
          is_immediate?: boolean
          knock_event_id?: string
          notes?: string | null
          status?: string
          status_set_at?: string | null
          status_set_by?: string | null
          uprn?: number
        }
        Relationships: [
          {
            foreignKeyName: "leads_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_knock_event_id_fkey"
            columns: ["knock_event_id"]
            isOneToOne: true
            referencedRelation: "knock_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_status_set_by_fkey"
            columns: ["status_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "leads_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      live_positions: {
        Row: {
          accuracy_m: number | null
          assignment_id: string | null
          canvasser_id: string
          heading_deg: number | null
          lat: number | null
          lon: number | null
          reported_at: string | null
        }
        Insert: {
          accuracy_m?: number | null
          assignment_id?: string | null
          canvasser_id: string
          heading_deg?: number | null
          lat?: number | null
          lon?: number | null
          reported_at?: string | null
        }
        Update: {
          accuracy_m?: number | null
          assignment_id?: string | null
          canvasser_id?: string
          heading_deg?: number | null
          lat?: number | null
          lon?: number | null
          reported_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_positions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_positions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_prop_completion"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "live_positions_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nccz_zones: {
        Row: {
          created_at: string
          geom: unknown
          id: string
          name: string | null
          source: string | null
        }
        Insert: {
          created_at?: string
          geom: unknown
          id?: string
          name?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string
          geom?: unknown
          id?: string
          name?: string | null
          source?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          crm_branch: string | null
          crm_name: string | null
          full_name: string | null
          id: string
          role: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          crm_branch?: string | null
          crm_name?: string | null
          full_name?: string | null
          id: string
          role: string
        }
        Update: {
          active?: boolean
          created_at?: string
          crm_branch?: string | null
          crm_name?: string | null
          full_name?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          created_at: string
          geom: unknown
          is_knockable: boolean | null
          is_multi_unit: boolean | null
          is_nccz: boolean
          postcode: string | null
          units_at_address: number
          units_at_point: number
          uprn: number
        }
        Insert: {
          created_at?: string
          geom: unknown
          is_knockable?: boolean | null
          is_multi_unit?: boolean | null
          is_nccz?: boolean
          postcode?: string | null
          units_at_address?: number
          units_at_point?: number
          uprn: number
        }
        Update: {
          created_at?: string
          geom?: unknown
          is_knockable?: boolean | null
          is_multi_unit?: boolean | null
          is_nccz?: boolean
          postcode?: string | null
          units_at_address?: number
          units_at_point?: number
          uprn?: number
        }
        Relationships: []
      }
      property_addresses: {
        Row: {
          building_name: string | null
          house_number: string | null
          match_confidence: string
          postcode: string | null
          property_type: string | null
          source: string
          street_name: string | null
          sub_building: string | null
          updated_at: string
          uprn: number
          uprn_source: string | null
        }
        Insert: {
          building_name?: string | null
          house_number?: string | null
          match_confidence: string
          postcode?: string | null
          property_type?: string | null
          source: string
          street_name?: string | null
          sub_building?: string | null
          updated_at?: string
          uprn: number
          uprn_source?: string | null
        }
        Update: {
          building_name?: string | null
          house_number?: string | null
          match_confidence?: string
          postcode?: string | null
          property_type?: string | null
          source?: string
          street_name?: string | null
          sub_building?: string | null
          updated_at?: string
          uprn?: number
          uprn_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_addresses_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "property_addresses_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: true
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      property_observations: {
        Row: {
          canvasser_id: string
          client_event_id: string
          id: string
          observed_at: string
          tenure: string | null
          uprn: number
        }
        Insert: {
          canvasser_id: string
          client_event_id: string
          id?: string
          observed_at: string
          tenure?: string | null
          uprn: number
        }
        Update: {
          canvasser_id?: string
          client_event_id?: string
          id?: string
          observed_at?: string
          tenure?: string | null
          uprn?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_observations_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_observations_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "property_observations_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      road_nodes: {
        Row: {
          geom: unknown
          id: number
        }
        Insert: {
          geom: unknown
          id: number
        }
        Update: {
          geom?: unknown
          id?: number
        }
        Relationships: []
      }
      road_segments: {
        Row: {
          from_node: number
          geom: unknown
          highway: string
          id: number
          length_m: number
          name: string | null
          osm_way_id: number
          to_node: number
        }
        Insert: {
          from_node: number
          geom: unknown
          highway: string
          id?: number
          length_m: number
          name?: string | null
          osm_way_id: number
          to_node: number
        }
        Update: {
          from_node?: number
          geom?: unknown
          highway?: string
          id?: number
          length_m?: number
          name?: string | null
          osm_way_id?: number
          to_node?: number
        }
        Relationships: [
          {
            foreignKeyName: "road_segments_from_node_fkey"
            columns: ["from_node"]
            isOneToOne: false
            referencedRelation: "road_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_segments_to_node_fkey"
            columns: ["to_node"]
            isOneToOne: false
            referencedRelation: "road_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      route_steps: {
        Row: {
          assignment_id: string
          cumulative_m: number
          first_seq: number | null
          geom: unknown
          id: number
          instruction: string
          is_dead_end: boolean
          is_spur: boolean
          kind: string | null
          last_seq: number | null
          segment_id: number | null
          side: string | null
          step_index: number
          street_name: string | null
          walk_geom: unknown
        }
        Insert: {
          assignment_id: string
          cumulative_m: number
          first_seq?: number | null
          geom: unknown
          id?: number
          instruction: string
          is_dead_end?: boolean
          is_spur?: boolean
          kind?: string | null
          last_seq?: number | null
          segment_id?: number | null
          side?: string | null
          step_index: number
          street_name?: string | null
          walk_geom?: unknown
        }
        Update: {
          assignment_id?: string
          cumulative_m?: number
          first_seq?: number | null
          geom?: unknown
          id?: number
          instruction?: string
          is_dead_end?: boolean
          is_spur?: boolean
          kind?: string | null
          last_seq?: number | null
          segment_id?: number | null
          side?: string | null
          step_index?: number
          street_name?: string | null
          walk_geom?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "route_steps_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_steps_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_prop_completion"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "route_steps_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "road_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      territories: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          geom: unknown
          id: string
          last_visited_at: string | null
          name: string
          visit_count: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          geom: unknown
          id?: string
          last_visited_at?: string | null
          name: string
          visit_count?: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          geom?: unknown
          id?: string
          last_visited_at?: string | null
          name?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "territories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_route_steps: {
        Row: {
          centreline: unknown
          first_seq: number | null
          from_node: number
          id: number
          instruction: string
          is_dead_end: boolean
          kind: string
          last_seq: number | null
          length_m: number
          route_id: string
          segment_id: number | null
          side: string
          step_index: number
          street_name: string | null
          to_node: number
          walkline: unknown
        }
        Insert: {
          centreline: unknown
          first_seq?: number | null
          from_node: number
          id?: number
          instruction: string
          is_dead_end?: boolean
          kind: string
          last_seq?: number | null
          length_m: number
          route_id: string
          segment_id?: number | null
          side: string
          step_index: number
          street_name?: string | null
          to_node: number
          walkline: unknown
        }
        Update: {
          centreline?: unknown
          first_seq?: number | null
          from_node?: number
          id?: number
          instruction?: string
          is_dead_end?: boolean
          kind?: string
          last_seq?: number | null
          length_m?: number
          route_id?: string
          segment_id?: number | null
          side?: string
          step_index?: number
          street_name?: string | null
          to_node?: number
          walkline?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "territory_route_steps_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "territory_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_routes: {
        Row: {
          door_order: number[]
          end_geom: unknown
          end_node_id: number
          end_to_start_m: number
          generated_at: string
          generated_by: string | null
          hand: string
          id: string
          non_working_m: number
          rank_cost_m: number
          return_m: number
          start_geom: unknown
          start_node_id: number
          straight_transfers: number
          stranded_count: number
          territory_id: string
          total_m: number
          variant_key: string
          warnings: string[]
          working_m: number
        }
        Insert: {
          door_order: number[]
          end_geom: unknown
          end_node_id: number
          end_to_start_m: number
          generated_at?: string
          generated_by?: string | null
          hand: string
          id?: string
          non_working_m: number
          rank_cost_m: number
          return_m?: number
          start_geom: unknown
          start_node_id: number
          straight_transfers?: number
          stranded_count: number
          territory_id: string
          total_m: number
          variant_key: string
          warnings?: string[]
          working_m: number
        }
        Update: {
          door_order?: number[]
          end_geom?: unknown
          end_node_id?: number
          end_to_start_m?: number
          generated_at?: string
          generated_by?: string | null
          hand?: string
          id?: string
          non_working_m?: number
          rank_cost_m?: number
          return_m?: number
          start_geom?: unknown
          start_node_id?: number
          straight_transfers?: number
          stranded_count?: number
          territory_id?: string
          total_m?: number
          variant_key?: string
          warnings?: string[]
          working_m?: number
        }
        Relationships: [
          {
            foreignKeyName: "territory_routes_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_routes_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      v_coverage_latest: {
        Row: {
          assignment_id: string | null
          occurred_at: string | null
          outcome: string | null
          slot: string | null
          territory_id: string | null
          uprn: number | null
          work_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knock_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knock_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_prop_completion"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "knock_events_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "knock_events_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      v_door_label: {
        Row: {
          building_name: string | null
          canvasser_supplied: boolean | null
          house_number: string | null
          street_name: string | null
          uprn: number | null
        }
        Relationships: []
      }
      v_latest_knock: {
        Row: {
          assignment_id: string | null
          canvasser_id: string | null
          notes: string | null
          occurred_at: string | null
          outcome: string | null
          uprn: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knock_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knock_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_prop_completion"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "knock_events_canvasser_id_fkey"
            columns: ["canvasser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knock_events_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["uprn"]
          },
          {
            foreignKeyName: "knock_events_uprn_fkey"
            columns: ["uprn"]
            isOneToOne: false
            referencedRelation: "v_door_label"
            referencedColumns: ["uprn"]
          },
        ]
      }
      v_prop_completion: {
        Row: {
          answered: number | null
          assignment_id: string | null
          knockable: number | null
          remaining: number | null
          territory_id: string | null
          territory_name: string | null
          visit_number: number | null
          work_date: string | null
          worked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      addresses_for_assignment: {
        Args: { p_assignment_id: string }
        Returns: {
          building_name: string
          house_number: string
          street_name: string
          uprn: number
        }[]
      }
      admin_dashboard: { Args: { p_stale_weeks?: number }; Returns: Json }
      admin_latest_knocks: {
        Args: {
          p_assignment_ids?: string[]
          p_canvasser_id?: string
          p_from?: string
          p_to?: string
        }
        Returns: {
          assignment_id: string
          canvasser_id: string
          occurred_at: string
          outcome: string
          uprn: number
        }[]
      }
      admin_live_positions: {
        Args: never
        Returns: {
          accuracy_m: number
          assignment_id: string
          canvasser_id: string
          first_name: string
          heading_deg: number
          lat: number
          lon: number
          reported_at: string
          route_length_m: number
          route_position_m: number
          territory_name: string
        }[]
      }
      admin_set_canvasser_active: {
        Args: { p_active: boolean; p_profile_id: string }
        Returns: boolean
      }
      admin_set_crm_name: {
        Args: { p_crm_branch: string; p_crm_name: string; p_profile_id: string }
        Returns: undefined
      }
      allocate_prop: {
        Args: {
          canvasser_ids: string[]
          territory_id: string
          work_date: string
        }
        Returns: {
          entry_vertex_index: number
          id: string
          knockable_doors: number
          slot: string
          sweep_direction: string
          visit_number: number
        }[]
      }
      app_role: { Args: never; Returns: string }
      apply_nccz_flags: { Args: never; Returns: number }
      assert_prop_polygon: { Args: { poly: unknown }; Returns: undefined }
      assignment_close_early: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      assignment_door_footprints: {
        Args: { p_assignment: string }
        Returns: Json
      }
      assignment_member_add: {
        Args: { p_assignment_id: string; p_canvasser_id: string }
        Returns: Json
      }
      assignment_member_remove: {
        Args: { p_assignment_id: string; p_canvasser_id: string }
        Returns: Json
      }
      assignment_remove: { Args: { p_assignment_id: string }; Returns: Json }
      assignment_route_freeze: {
        Args: { p_assignment_id: string; p_variant_key?: string }
        Returns: Json
      }
      count_door_eligibility: {
        Args: { poly: unknown }
        Returns: {
          knockable: number
          multi_unit: number
          nccz: number
          total: number
        }[]
      }
      count_knockable: {
        Args: { poly: unknown }
        Returns: {
          excluded: number
          knockable: number
          total: number
        }[]
      }
      coverage_map_payload: { Args: never; Returns: Json }
      crm_canvasser_names: {
        Args: never
        Returns: {
          branch: string
          canvasser: string
          latest: string
          leads: number
        }[]
      }
      crm_door_history: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          blowout: number
          lat: number
          latest_at: string
          latest_status: string
          leads: number
          lon: number
          other: number
          pm: number
          sale: number
          uprn: number
          utc: number
        }[]
      }
      crm_heat_grid: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          lat: number
          leads: number
          lon: number
          pitched: number
          revenue: number
          sales: number
        }[]
      }
      crm_insights: { Args: { p_from?: string; p_to?: string }; Returns: Json }
      crm_leaderboard: {
        Args: { p_from: string; p_to: string }
        Returns: {
          branch: string
          canvasser: string
          leads: number
          pitched: number
          revenue: number
          sales_with_amount: number
          sold: number
        }[]
      }
      crm_match_batch: {
        Args: { p_rows: Json }
        Returns: {
          crm_id: string
          lat: number
          lon: number
          tier: string
          uprn: number
        }[]
      }
      crm_norm_street: { Args: { p: string }; Returns: string }
      crm_sync_tick: { Args: never; Returns: number }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      insert_nccz_zone: {
        Args: { p_geojson: Json; p_name: string; p_source: string }
        Returns: string
      }
      is_assignment_member: { Args: { a: string }; Returns: boolean }
      list_property_uprns: {
        Args: { p_after?: number; p_limit?: number }
        Returns: Json
      }
      logging_default: { Args: never; Returns: string }
      longtransactionsenabled: { Args: never; Returns: boolean }
      my_crm_branch: { Args: never; Returns: string }
      my_crm_callbacks: {
        Args: { p_days: number }
        Returns: {
          address_line: string
          alt_phone: string
          appointment_at: string
          best_time: string
          building_name: string
          call_back_on: string
          callback_reason: string
          crm_created_at: string
          crm_id: string
          description: string
          house_number: string
          last_called_at: string
          last_result: string
          phone: string
          postcode: string
          postcode_sector: string
          product_interest: string
          result_note: string
          status: string
          street_name: string
          surname: string
          title: string
          uprn: number
        }[]
      }
      my_crm_leads: {
        Args: { p_from: string; p_to: string }
        Returns: {
          appointment_at: string
          building_name: string
          callback_reason: string
          crm_created_at: string
          crm_id: string
          house_number: string
          lat: number
          lon: number
          postcode_sector: string
          sale_amount: number
          status: string
          street_name: string
          uprn: number
        }[]
      }
      my_crm_name: { Args: never; Returns: string }
      nccz_zones_geojson: { Args: never; Returns: Json }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      properties_in_polygon: {
        Args: { cap?: number; poly: unknown }
        Returns: Json
      }
      rebuild_door_footprints: {
        Args: { p_territory: string }
        Returns: number
      }
      refresh_door_eligibility: { Args: never; Returns: Json }
      report_position: {
        Args: {
          p_accuracy_m?: number
          p_assignment_id: string
          p_heading_deg?: number
          p_lat: number
          p_lon: number
          p_route_position_m?: number
        }
        Returns: {
          canvasser_id: string
          route_position_at: string
          route_position_m: number
        }[]
      }
      route_clipped_subgraph: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      route_commit: {
        Args: {
          p_assignment_id: string
          p_route_length_m: number
          p_route_wkt: string
          p_snapshot: number[]
          p_steps: Json
          p_stranded_count: number
        }
        Returns: Json
      }
      route_walk_inputs: { Args: { p_territory_id: string }; Returns: Json }
      set_logging_default: { Args: { p_mode: string }; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      stop_sharing_position: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      territory_routes_save: {
        Args: { p_territory_id: string; p_variants: Json }
        Returns: Json
      }
      todays_assignment: { Args: never; Returns: Json }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      upsert_building_footprints: { Args: { p_rows: Json }; Returns: number }
      upsert_properties: { Args: { p_rows: Json }; Returns: number }
      upsert_property_addresses: { Args: { p_rows: Json }; Returns: number }
      upsert_road_nodes: { Args: { p_rows: Json }; Returns: number }
      upsert_road_segments: { Args: { p_rows: Json }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
